"""Start mit ``python -m meit`` (Host/Port über MEIT_HOST / MEIT_PORT)."""

import os

import uvicorn


def main() -> None:
    host = os.environ.get("MEIT_HOST", "127.0.0.1")
    port = int(os.environ.get("MEIT_PORT", "8080"))
    print(f"ME-IT Cockpit läuft auf http://{'localhost' if host in ('127.0.0.1', '0.0.0.0') else host}:{port}")
    uvicorn.run("meit.main:app", host=host, port=port)


if __name__ == "__main__":
    main()
