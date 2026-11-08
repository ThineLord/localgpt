"""Guarded subprocess fixture for test_generation_recovery_http; never a launcher.

The factory receives fresh test paths and explicit ephemeral mock URLs. Audit
hooks deny other SQLite paths, writes outside the fixture, subprocesses, and
network connections outside the fixture's mock port.
"""
import argparse
import ast
import asyncio
import contextlib
import json
import os
from pathlib import Path
import signal
import shutil
import sys
from types import SimpleNamespace
from urllib.parse import unquote, urlparse


def install_guard(root, ports):
    events = {"connects": [], "denied": [], "sqlite_paths": []}

    def path_for(value):
        if isinstance(value, int) or value is None:
            return None
        value = os.fsdecode(value)
        if value.startswith("file:"):
            value = unquote(urlparse(value).path)
        return Path(value).resolve()

    def within(path):
        return path == root or root in path.parents

    def deny(event, detail):
        events["denied"].append([event, str(detail)])
        raise PermissionError("APP-03 fixture isolation: " + event + " " + str(detail))

    def audit(event, args):
        if event == "open":
            path = path_for(args[0])
            mode, flags = args[1:3]
            writing = ((mode and any(c in mode for c in "wax+")) or
                       flags & (os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC))
            if path and writing and not within(path):
                deny(event, path)
            if path and not within(path) and (
                path.suffix in (".sqlite3", ".sqlite", ".db") or
                path.name.endswith(("-wal", "-shm")) or path.name == ".env"
            ):
                deny(event, path)
        elif event == "sqlite3.connect":
            path = path_for(args[0])
            if not path or not within(path):
                deny(event, path)
            events["sqlite_paths"].append(str(path))
        elif event in ("os.mkdir", "os.remove", "os.rmdir", "os.chmod", "os.truncate"):
            path = path_for(args[0])
            if path and not within(path):
                deny(event, path)
        elif event in ("os.rename", "os.link", "os.symlink"):
            for arg in args[:2]:
                path = path_for(arg)
                if path and not within(path):
                    deny(event, path)
        elif event == "socket.connect":
            address = args[1]
            if not isinstance(address, tuple) or address[0] != "127.0.0.1" or address[1] not in ports:
                deny(event, address)
            events["connects"].append(list(address))
        elif event == "socket.bind":
            address = args[1]
            if isinstance(address, tuple) and (address[0] != "127.0.0.1" or address[1] != 0):
                deny(event, address)
        elif event == "subprocess.Popen":
            deny(event, args[0])

    sys.addaudithook(audit)
    return events


async def main(args):
    root = Path(args.root).resolve(strict=True)
    mock_port = urlparse(args.mock).port
    if mock_port in (8190, 8188, 1234) or urlparse(args.mock).hostname != "127.0.0.1":
        raise ValueError("Only an ephemeral fixture mock port is allowed")
    guard = install_guard(root, {mock_port})
    sys.path.insert(0, args.source)
    import aiohttp
    from aiohttp import web
    import lm_chat
    import serve

    lm_chat.LM_URL = args.mock
    lm_chat.LMS = root / "FORBIDDEN_MODEL_CLI"
    if args.timeout:
        original = aiohttp.ClientSession._request

        async def bounded(self, method, url, **kwargs):
            if str(url).endswith("/v1/chat/completions"):
                kwargs["timeout"] = aiohttp.ClientTimeout(total=.5, sock_read=.2)
            return await original(self, method, url, **kwargs)

        aiohttp.ClientSession._request = bounded
    for name in ("input", "output"):
        (root / name).mkdir(exist_ok=True)
    if args.backend:
        # Execute exact backend lifecycle/Stop bodies without importing the
        # extension's production folder discovery or a real Comfy server.
        from storage import Store, Conflict
        from generation import clean_draft, image_path, graph
        import generation_ownership
        store = Store(root / "synthetic.sqlite3")
        routes = web.RouteTableDef()
        app = web.Application()

        def reply(data, status=200):
            return web.json_response(data, status=status)

        def mutate(request):
            if request.content_type != "application/json":
                raise web.HTTPUnsupportedMediaType()

        async def comfy(session, route, payload=None):
            async with session.request("GET" if payload is None else "POST",
                                       args.mock + route, json=payload) as response:
                response.raise_for_status()
                return await response.json()

        async def inert_monitor():
            await asyncio.Event().wait()

        namespace = dict(STORE=store, CHAT_TASKS=lm_chat.CHAT_TASKS,
                         generation_ownership=generation_ownership, asyncio=asyncio,
                         contextlib=contextlib, monitor=inert_monitor, mutate=mutate,
                         reply=reply, web=web, aiohttp=aiohttp, comfy=comfy)
        backend_path = Path(args.source) / "backend.py"
        tree = ast.parse(backend_path.read_text())
        functions = [node for node in tree.body if isinstance(node, ast.AsyncFunctionDef)
                     and node.name in ("lifecycle", "stop")]
        if {node.name for node in functions} != {"lifecycle", "stop"}:
            raise AssertionError("Backend lifecycle/Stop extraction failed")
        for node in functions:
            node.decorator_list = []
        exec(compile(ast.Module(body=functions, type_ignores=[]), str(backend_path), "exec"), namespace)
        core = SimpleNamespace(
            STORE=store, Conflict=Conflict, reply=reply, mutate=mutate,
            SUBMIT_LOCK=asyncio.Lock(), comfy=comfy, graph=graph, shutil=shutil,
            clean_draft=lambda data: clean_draft(data, root / "input", root / "output"),
            image_path=lambda image: image_path(image, root / "input", root / "output"),
            folder_paths=SimpleNamespace(get_output_directory=lambda: root / "output"),
            PromptServer=SimpleNamespace(instance=SimpleNamespace(routes=routes)),
        )
        lm_chat.install(core)
        app.add_routes(routes)
        app.router.add_post("/qwen-cn/messages/{message_id}/stop", namespace["stop"])
        app.cleanup_ctx.append(namespace["lifecycle"])
    else:
        app = serve.create_app(args.mock, database=root / "synthetic.sqlite3",
                               input_root=root / "input", output_root=root / "output")

    async def fixture_tasks(request):
        return web.json_response({"tasks": list(lm_chat.CHAT_TASKS), "guard": guard})

    app.router.add_get("/__fixture/tasks", fixture_tasks)
    runner = web.AppRunner(app, shutdown_timeout=.5, access_log=None)
    await runner.setup()
    await web.TCPSite(runner, "127.0.0.1", 0).start()
    ready = root / (args.name + "-ready.json")
    temporary = ready.with_suffix(".tmp")
    temporary.write_text(json.dumps({
        "port": runner.addresses[0][1], "pid": os.getpid(), "guard": guard,
    }))
    temporary.replace(ready)
    stop = asyncio.Event()
    for sig in (signal.SIGTERM, signal.SIGINT):
        asyncio.get_running_loop().add_signal_handler(sig, stop.set)
    try:
        await asyncio.wait_for(stop.wait(), 45)
    except asyncio.TimeoutError:
        pass
    finally:
        await runner.cleanup()
        (root / (args.name + "-guard.json")).write_text(json.dumps(guard))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--mock", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--timeout", action="store_true")
    parser.add_argument("--backend", action="store_true")
    asyncio.run(main(parser.parse_args()))
