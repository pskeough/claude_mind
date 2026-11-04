"""GPU lease + board for parallel Claude chats sharing local NVIDIA GPUs. Optional part of paper-forge.

State lives in a shared folder, by default ~/.paper_forge/gpu/ (on Windows %USERPROFILE%\\.paper_forge\\gpu\\).
Override with --state-dir or the PAPER_FORGE_GPU_DIR environment variable. Every chat must use the same folder.
  leases/gpu<N>.json   one file per held card, created atomically (O_EXCL)
  BOARD.md             append-only log where chats propose, claim, release and object

Cards are detected with nvidia-smi. Use --gpus 0,1 to restrict the set.

Usage (python -u):
  gpu_lease.py status
  gpu_lease.py post   --owner P3 --msg "want GPU for ~90 min: control rerun, 9 GB"
  gpu_lease.py acquire --owner P3 --gpu any --minutes 90 --vram-gb 9 --purpose "..."
  gpu_lease.py renew  --owner P3 --minutes 60
  gpu_lease.py release --owner P3
  gpu_lease.py board  [--tail 40]

Rules the tool enforces:
  - a card with a live lease is never granted to another owner
  - a card is treated as busy if nvidia-smi shows more than BUSY_MB used, lease or not
  - a lease past its expiry by more than GRACE_MIN can be broken by acquire, and the break is logged
  - every acquire and release is appended to BOARD.md
Exit code 0 = granted/ok, 2 = no card free, 1 = error.
"""
import argparse, json, os, subprocess, sys, datetime as dt
from pathlib import Path

BUSY_MB = 3000   # display and desktop apps usually sit around 0.4-1.3 GB; raise this if your idle desktop uses more
GRACE_MIN = 30

ROOT = LEASES = BOARD = None
GPUS = []


def configure(state_dir, gpus_arg):
    global ROOT, LEASES, BOARD, GPUS
    ROOT = Path(state_dir or os.environ.get("PAPER_FORGE_GPU_DIR") or (Path.home() / ".paper_forge" / "gpu"))
    LEASES = ROOT / "leases"
    BOARD = ROOT / "BOARD.md"
    if gpus_arg:
        GPUS = [int(x) for x in gpus_arg.split(",") if x.strip()]
    else:
        GPUS = sorted(smi().keys())


def now():
    return dt.datetime.now().replace(microsecond=0)


def post(owner, msg):
    ROOT.mkdir(parents=True, exist_ok=True)
    with open(BOARD, "a", encoding="utf-8", newline="\n") as f:
        f.write(f"- {now().isoformat()} [{owner}] {msg}\n")


def smi():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=index,memory.used,memory.total,utilization.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=30).stdout
    except Exception as e:  # noqa: BLE001
        print(f"nvidia-smi failed: {e}", file=sys.stderr)
        return {}
    res = {}
    for line in out.strip().splitlines():
        try:
            i, used, total, util = [x.strip() for x in line.split(",")]
            res[int(i)] = {"used_mb": int(used), "total_mb": int(total), "util": int(util)}
        except ValueError:
            continue
    return res


def lease_path(g):
    return LEASES / f"gpu{g}.json"


def read_lease(g):
    p = lease_path(g)
    if not p.exists():
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def expired(lease, grace=0):
    exp = dt.datetime.fromisoformat(lease["expires"])
    return now() > exp + dt.timedelta(minutes=grace)


def status():
    if not GPUS:
        print("No GPUs found (nvidia-smi missing or reports none).")
        return 0
    s = smi()
    for g in GPUS:
        l = read_lease(g)
        mem = s.get(g, {})
        state = "FREE"
        if l:
            state = f"LEASED by {l['owner']} until {l['expires']} ({l['purpose']})"
            if expired(l):
                state += "  [EXPIRED]"
        elif mem.get("used_mb", 0) > BUSY_MB:
            state = "BUSY (no lease, memory in use)"
        print(f"GPU{g}: {state} | {mem.get('used_mb','?')}/{mem.get('total_mb','?')} MB, util {mem.get('util','?')}%")
    return 0


def acquire(owner, gpu, minutes, vram_gb, purpose):
    if not GPUS:
        print("No GPUs found (nvidia-smi missing or reports none).", file=sys.stderr)
        return 1
    LEASES.mkdir(parents=True, exist_ok=True)
    s = smi()
    order = GPUS if gpu == "any" else [int(gpu)]
    for g in order:
        l = read_lease(g)
        if l and l["owner"] == owner and not expired(l):
            print(f"GPU{g} already held by {owner}")
            return 0
        if l and not expired(l, GRACE_MIN):
            continue
        if l:  # stale lease
            post(owner, f"BROKE stale lease on GPU{g} held by {l['owner']} (expired {l['expires']})")
            lease_path(g).unlink(missing_ok=True)
        mem = s.get(g)
        if mem is None:  # card not visible to nvidia-smi right now; do not guess its memory
            continue
        if mem["used_mb"] > BUSY_MB:
            continue
        if vram_gb and (mem["total_mb"] - mem["used_mb"]) < vram_gb * 1024:
            continue
        lease = {"owner": owner, "gpu": g, "purpose": purpose, "vram_gb": vram_gb,
                 "acquired": now().isoformat(),
                 "expires": (now() + dt.timedelta(minutes=minutes)).isoformat()}
        try:
            fd = os.open(lease_path(g), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            continue
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(lease, f, indent=1)
        post(owner, f"ACQUIRED GPU{g} for {minutes} min, {vram_gb} GB: {purpose}. Use CUDA_VISIBLE_DEVICES={g}")
        print(f"GRANTED GPU{g}. Set CUDA_DEVICE_ORDER=PCI_BUS_ID and CUDA_VISIBLE_DEVICES={g} (nvidia-smi index order). Expires {lease['expires']}")
        return 0
    print("NO CARD FREE. Run `status` and read the board; post your request and wait.")
    return 2


def renew(owner, minutes):
    for g in GPUS:
        l = read_lease(g)
        if l and l["owner"] == owner:
            l["expires"] = (now() + dt.timedelta(minutes=minutes)).isoformat()
            with open(lease_path(g), "w", encoding="utf-8") as f:
                json.dump(l, f, indent=1)
            post(owner, f"RENEWED GPU{g} to {l['expires']}")
            print(f"GPU{g} renewed to {l['expires']}")
    return 0


def release(owner):
    n = 0
    for g in GPUS:
        l = read_lease(g)
        if l and l["owner"] == owner:
            lease_path(g).unlink(missing_ok=True)
            post(owner, f"RELEASED GPU{g}")
            print(f"released GPU{g}")
            n += 1
    if not n:
        print("nothing held")
    return 0


def board(tail):
    if not BOARD.exists():
        print("(board empty)")
        return 0
    with open(BOARD, encoding="utf-8") as f:
        lines = f.readlines()
    sys.stdout.write("".join(lines[-tail:]))
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["status", "post", "acquire", "renew", "release", "board"])
    ap.add_argument("--owner")
    ap.add_argument("--msg")
    ap.add_argument("--gpu", default="any")
    ap.add_argument("--minutes", type=int, default=60)
    ap.add_argument("--vram-gb", type=float, default=0)
    ap.add_argument("--purpose", default="")
    ap.add_argument("--tail", type=int, default=40)
    ap.add_argument("--state-dir", default=None, help="shared lease folder (default ~/.paper_forge/gpu)")
    ap.add_argument("--gpus", default=None, help="comma-separated GPU indices to manage (default: all nvidia-smi reports)")
    a = ap.parse_args()
    if a.cmd in ("post", "acquire", "renew", "release") and not a.owner:
        ap.error("--owner required")
    configure(a.state_dir, a.gpus if a.cmd not in ("post", "board") else (a.gpus or "0"))
    if a.cmd == "status":
        return status()
    if a.cmd == "post":
        post(a.owner, a.msg or "")
        return 0
    if a.cmd == "acquire":
        return acquire(a.owner, a.gpu, a.minutes, a.vram_gb, a.purpose)
    if a.cmd == "renew":
        return renew(a.owner, a.minutes)
    if a.cmd == "release":
        return release(a.owner)
    return board(a.tail)


if __name__ == "__main__":
    sys.exit(main() or 0)
