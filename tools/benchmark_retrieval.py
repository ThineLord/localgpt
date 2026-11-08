"""Disposable project retrieval benchmark; no services, models or personal data."""
import argparse
import asyncio
import json
from pathlib import Path
import statistics
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'work' / 'chat-sidebar'))
from project_store import ProjectStore
from storage import Store


async def measure(projects, chat):
    lags = []
    finished = asyncio.Event()
    async def heartbeat():
        while not finished.is_set():
            start = time.perf_counter()
            await asyncio.sleep(.01)
            lags.append(max(0, time.perf_counter() - start - .01))
    tick = asyncio.create_task(heartbeat())
    await asyncio.sleep(0)
    start = time.perf_counter()
    try:
        _, body, metadata = await projects.context_async(chat['id'], 'synthetic experiment benchmark evidence source calibration')
        elapsed = time.perf_counter() - start
    finally:
        finished.set()
        await tick
    return {'context_seconds': round(elapsed, 6), 'heartbeat_delay_seconds': round(max(lags, default=0), 6),
            'selected_sources': len(metadata['source_ids']), 'result_characters': len(body)}


async def run():
    results = []
    with tempfile.TemporaryDirectory(prefix='localgpt-retrieval-benchmark-') as folder:
        store = Store(Path(folder) / 'synthetic.sqlite3')
        projects = ProjectStore(store)
        for label, count, chars in [('small', 1, 10000), ('medium', 20, 100000), ('documented_maximum', 100, 200000)]:
            project = projects.create({'name': 'Synthetic ' + label})
            chat = projects.create_chat('Synthetic benchmark', project['id'])
            start = time.perf_counter()
            for i in range(count):
                line = f'Synthetic source {i}: experiment benchmark evidence source calibration; dataset control methods observations and analysis.\n'
                text = (line * (chars // len(line) + 1))[:chars]
                projects.add_source(project['id'], f'synthetic-{i}.txt', text.encode())
            creation = time.perf_counter() - start
            runs = [await measure(projects, chat) for _ in range(3)]
            results.append({'name': label, 'sources': count, 'characters_per_source': chars,
                'fixture_creation_seconds': round(creation, 3), 'runs': runs,
                'median_context_seconds': round(statistics.median(r['context_seconds'] for r in runs), 6),
                'max_heartbeat_delay_seconds': max(r['heartbeat_delay_seconds'] for r in runs)})
        with store.connect() as db:
            db.execute('DELETE FROM project_source_index WHERE source_id IN (SELECT id FROM project_sources WHERE project_id=?)', (project['id'],))
        cold = await measure(projects, chat)
    return {'synthetic_only': True, 'cases': results, 'legacy_index_rebuild': cold}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--max-warm-seconds', type=float, default=1)
    parser.add_argument('--max-loop-delay', type=float, default=.25)
    args = parser.parse_args()
    report = asyncio.run(run())
    encoded = json.dumps(report, indent=2)
    print(encoded)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + '\n')
    if args.check:
        if any(c['median_context_seconds'] > args.max_warm_seconds or c['max_heartbeat_delay_seconds'] > args.max_loop_delay for c in report['cases']):
            raise SystemExit('Retrieval performance budget exceeded')
        if report['legacy_index_rebuild']['heartbeat_delay_seconds'] > args.max_loop_delay:
            raise SystemExit('Legacy index rebuild blocked the event loop')


if __name__ == '__main__':
    main()
