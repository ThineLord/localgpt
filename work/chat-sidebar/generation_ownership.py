"""Single-host POSIX generation ownership. Never unlink/replace the lock file.

Both writers must be upgraded together. flock is not evidence that a legacy
writer (which does not participate in this protocol) has stopped.
"""
import errno
import fcntl
import os
from pathlib import Path
import sqlite3
import stat
import uuid

PROTOCOL = 1
ACTIVE = ('submitting', 'running')


class OwnershipUnavailable(OSError):
    pass


class GenerationLock:
    def __init__(self, database):
        self.database = Path(database).resolve(strict=True)
        self.path = self.database.with_name(self.database.name + '.generation.lock')
        self.fd = None
        self.nonce = uuid.uuid4().hex
        self.pid = os.getpid()

    def acquire(self):
        if self.fd is not None or self.pid != os.getpid():
            raise OwnershipUnavailable('Generation lock handle cannot be reused while held or after fork')
        dbstat = self.database.stat()
        if not stat.S_ISREG(dbstat.st_mode) or dbstat.st_nlink != 1:
            raise OwnershipUnavailable('Generation database must be a single-link regular file')
        fd = os.open(self.path, os.O_CREAT | os.O_RDWR | os.O_CLOEXEC | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(fd)
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise OwnershipUnavailable('Unsafe generation lock file')
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                if error.errno in (errno.EAGAIN, errno.EACCES):
                    os.close(fd)
                    return False
                raise
            self.fd = fd
            self.database_identity = (dbstat.st_dev, dbstat.st_ino)
            self.lock_identity = (info.st_dev, info.st_ino)
            self.validate(self.database)
            return True
        except BaseException:
            self.fd = None
            os.close(fd)
            raise

    def validate(self, database):
        if self.fd is None or self.pid != os.getpid() or Path(database).resolve(strict=True) != self.database:
            raise OwnershipUnavailable('Generation ownership handle is not valid')
        dbstat = self.database.stat()
        lockstat = self.path.lstat()
        if (dbstat.st_dev, dbstat.st_ino) != self.database_identity or dbstat.st_nlink != 1:
            raise OwnershipUnavailable('Generation database identity changed')
        if (lockstat.st_dev, lockstat.st_ino) != self.lock_identity or not stat.S_ISREG(lockstat.st_mode) or lockstat.st_nlink != 1:
            raise OwnershipUnavailable('Generation lock identity changed')

    def close(self):
        if self.fd is not None:
            # close, not LOCK_UN: an inherited descriptor must not unlock its parent.
            os.close(self.fd)
            self.fd = None


def reconcile(store):
    """Best effort startup/Stop recovery; failures remain visible and fail closed."""
    owner = None
    try:
        owner = GenerationLock(store.path)
        if not owner.acquire():
            return {'generation_recovery_ready': False, 'generation_recovery_state': 'busy', 'recovered': 0}
        return store.reconcile_generation(owner)
    except (OSError, sqlite3.Error):
        return {'generation_recovery_ready': False, 'generation_recovery_state': 'unavailable', 'recovered': 0}
    finally:
        if owner is not None:
            owner.close()


def readiness(store):
    """Read-only: health never recovers or rewrites a message."""
    owner = None
    try:
        owner = GenerationLock(store.path)
        if not owner.acquire():
            return {'generation_recovery_ready': False, 'generation_recovery_state': 'busy'}
        return store.generation_status(owner)
    except OSError:
        return {'generation_recovery_ready': False, 'generation_recovery_state': 'unavailable'}
    finally:
        if owner is not None:
            owner.close()
