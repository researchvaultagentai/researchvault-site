#!/usr/bin/env python3
"""An isolated preview on the existing VPS. Never changes production DNS.

bootstrap: publish a separate HTTP ACME vhost; https: enable its new certificate.
No package installation, service restart, payment/tunnel edit, or live cutover.
"""
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

MODE = sys.argv[1] if len(sys.argv) == 2 else "check"
LIVE = MODE.startswith("live")
HOST = "www.researchvaultagent.ir" if LIVE else "iran-preview.researchvaultagent.ir"
NAMES = HOST + (" researchvaultagent.ir" if LIVE else "")
BASELINE = "0dc29fc7f1beb6417eb0641b77df848f5a0c60bc"
SOURCE = Path(__file__).resolve().parents[1]
BASE = Path("/srv/researchvault-iran-live" if LIVE else "/srv/researchvault-iran-preview")
PUBLIC = BASE / "public"
STATE = BASE / "protected-configs.json"
# Nginx uses the first vhost as its implicit default. Load after existing sites,
# otherwise an unknown Host used by an existing tunnel could change behavior.
SITE = "zzz-researchvault-iran-live" if LIVE else "zz-researchvault-iran-preview"
CONF = Path("/etc/nginx/sites-available") / SITE
LINK = Path("/etc/nginx/sites-enabled") / SITE
CERT = Path("/etc/letsencrypt/live/rv-iran-live" if LIVE else "/etc/letsencrypt/live/rv-iran-preview")
MARKER = "# ResearchVault isolated Iran preview\n"
EXTENSIONS = {".html", ".css", ".js", ".json", ".txt", ".xml", ".ico", ".svg",
              ".png", ".jpg", ".jpeg", ".webp", ".avif", ".woff", ".woff2", ".ttf", ".pdf"}


def run(*args):
    return subprocess.run(args, check=True, text=True, capture_output=True, timeout=120).stdout.strip()


def protected_configs():
    paths = []
    for root in (Path("/etc/nginx"), Path("/etc/cloudflared")):
        if root.exists():
            paths.extend(p for p in root.rglob("*") if p.is_file() and p not in (CONF, LINK))
    paths.extend(Path("/etc/systemd/system").glob("*.service"))
    return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(paths))}


def guard():
    expected = json.loads(STATE.read_text())
    actual = protected_configs()
    if expected != actual:
        changed = sorted(k for k in set(expected) | set(actual) if expected.get(k) != actual.get(k))
        raise RuntimeError("Existing configuration changed; refusing to proceed: " + ", ".join(changed))


def build_public(source, destination):
    destination.mkdir(parents=True, exist_ok=True)
    candidates = [p for p in source.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS]
    for dirname in ("assets", "css", "js", "patent", "images", "img"):
        folder = source / dirname
        if folder.exists():
            candidates.extend(p for p in folder.rglob("*") if p.is_file()
                              and p.suffix.lower() in EXTENSIONS
                              and not any(part.startswith(".") for part in p.relative_to(source).parts))
    for src in candidates:
        if src.is_symlink():
            raise RuntimeError("Unexpected public asset symlink: " + str(src))
        dest = destination / src.relative_to(source)
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dest)
        dest.chmod(0o644)
    client = destination / "patent/assets/patent.js"
    text = client.read_text()
    old = "(window.PATENT_API_BASE || 'https://patent-api.researchvaultagent.ir')"
    if text.count(old) != 1:
        raise RuntimeError("Unexpected patent API client; stop for review")
    client.write_text(text.replace(old, "(window.PATENT_API_BASE || '')"))
    context = destination / "assets/rv-support-context.js"
    text = context.read_text()
    old = "if (origin === 'https://researchvaultagent.ir' || origin === 'https://www.researchvaultagent.ir')"
    if text.count(old) != 1:
        raise RuntimeError("Unexpected support scope code; stop for review")
    if not LIVE:
        context.write_text(text.replace(old, "if (origin === 'https://" + HOST + "' || " + old[4:]))
        (destination / "robots.txt").write_text("User-agent: *\nDisallow: /\n")
    (destination / "assets/iran-preview-status.json").write_text(json.dumps({
        "preview": not LIVE, "baseline": BASELINE, "frontend": "iran-vps",
    }))
    assert not (destination / "patent-api").exists()
    assert not (destination / "functions").exists()
    assert not (destination / ".git").exists()
    return len(candidates)


def ipv4_resolver():
    for line in Path('/etc/resolv.conf').read_text().splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == 'nameserver':
            try:
                value = ipaddress.ip_address(fields[1])
            except ValueError:
                continue
            if value.version == 4:
                return str(value)
    raise RuntimeError('No existing IPv4 DNS resolver; stop for review')


def config(tls=False):
    http = MARKER + f"""server {{
    listen 80;
    server_name {NAMES};
    root {PUBLIC};
    location ^~ /.well-known/acme-challenge/ {{ try_files $uri =404; }}
    location / {{ {'return 301 https://' + HOST + '$request_uri;' if tls else 'return 503;'} }}
}}
"""
    if not tls:
        return http
    def proxy(name):
        return f"""        proxy_http_version 1.1;
        set $rv_upstream {name};
        proxy_pass https://$rv_upstream$request_uri;
        proxy_set_header Host {name};
        proxy_set_header Connection "";
        proxy_ssl_server_name on;
        proxy_ssl_name {name};
        proxy_ssl_verify on;
        proxy_ssl_verify_depth 5;
        proxy_ssl_trusted_certificate /etc/ssl/certs/ca-certificates.crt;
        proxy_set_header X-RV-Client-IP $remote_addr;
        proxy_set_header X-RV-Public-Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto https;
        proxy_connect_timeout 5s;
        proxy_read_timeout 60s;
        proxy_hide_header Alt-Svc;
"""
    redirect = f"""server {{
    listen 443 ssl;
    server_name researchvaultagent.ir;
    ssl_certificate {CERT}/fullchain.pem;
    ssl_certificate_key {CERT}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    return 301 https://{HOST}$request_uri;
}}
""" if LIVE else ""
    return http + redirect + f"""server {{
    listen 443 ssl;
    server_name {HOST};
    ssl_certificate {CERT}/fullchain.pem;
    ssl_certificate_key {CERT}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    # This VPS has no working outbound IPv6. Resolve these upstreams to A only.
    resolver {ipv4_resolver()} ipv6=off valid=300s;
    resolver_timeout 3s;
    root {PUBLIC};
    index index.html;
    autoindex off;
    client_max_body_size 16m;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer-when-downgrade always;
    {'' if LIVE else 'add_header X-Robots-Tag "noindex, nofollow" always;'}
    add_header Cache-Control "no-cache" always;
    access_log /var/log/nginx/{'researchvault-iran-live' if LIVE else 'researchvault-iran-preview'}.access.log;
    error_log /var/log/nginx/{'researchvault-iran-live' if LIVE else 'researchvault-iran-preview'}.error.log;
    location ^~ /api/ {{
{proxy('patent-api.researchvaultagent.ir')}    }}
    location ^~ /support/ {{
{proxy('cf-origin.researchvaultagent.ir')}
    }}
    location ~ /\\. {{ deny all; }}
    location / {{ try_files $uri $uri/ $uri.html =404; }}
}}
"""


def install(tls=False):
    if os.geteuid() != 0:
        raise RuntimeError("Run only as root on the intended VPS")
    if CONF.exists() and not CONF.read_text().startswith(MARKER):
        raise RuntimeError("Preview filename already belongs to another configuration")
    if LINK.is_symlink() and LINK.resolve() != CONF:
        raise RuntimeError("Unexpected existing preview symlink")
    if LINK.exists() and not LINK.is_symlink():
        raise RuntimeError("Unexpected existing preview file")
    existing = [p.name for p in LINK.parent.iterdir() if p != LINK]
    if any(name >= LINK.name for name in existing):
        raise RuntimeError("Preview must load after existing vhosts to preserve their defaults")
    if BASE.exists() and not STATE.exists():
        raise RuntimeError("Refusing to reuse an unrecognized directory")
    if not BASE.exists():
        BASE.mkdir(mode=0o755)
        STATE.write_text(json.dumps(protected_configs(), sort_keys=True))
        STATE.chmod(0o600)
    guard()
    count = build_public(SOURCE, PUBLIC)
    if tls and not (CERT / "fullchain.pem").is_file():
        raise RuntimeError("Obtain the dedicated preview certificate first")
    old = CONF.read_text() if CONF.exists() else None
    old_link = LINK.is_symlink()
    CONF.write_text(config(tls))
    CONF.chmod(0o644)
    if not old_link:
        LINK.symlink_to(CONF)
    try:
        guard()
        run("nginx", "-t")
        run("nginx", "-s", "reload")
    except Exception:
        if old is None:
            CONF.unlink(missing_ok=True)
        else:
            CONF.write_text(old)
        if not old_link:
            LINK.unlink(missing_ok=True)
        raise
    guard()
    if tls:
        hook = Path('/etc/letsencrypt/renewal-hooks/deploy/researchvault-iran-reload')
        hook.parent.mkdir(parents=True, exist_ok=True)
        marker = '# ResearchVault own-certificate reload hook\n'
        if hook.exists() and marker not in hook.read_text():
            raise RuntimeError('Unexpected renewal-hook file; stop for review')
        hook.write_text('#!/bin/sh\n' + marker + 'case "$RENEWED_LINEAGE" in\n'
                        '  /etc/letsencrypt/live/rv-iran-preview|/etc/letsencrypt/live/rv-iran-live)\n'
                        '    /usr/sbin/nginx -t && /usr/sbin/nginx -s reload ;;\n'
                        'esac\n')
        hook.chmod(0o755)
    print(json.dumps({"host": HOST, "tls": tls, "public_assets": count,
                      "existing_configs_unchanged": True, "production_dns_changed": False}))


def check():
    with tempfile.TemporaryDirectory() as temp:
        dest = Path(temp)
        count = build_public(SOURCE, dest)
        assert (dest / "index.html").exists() and (dest / "patent/index.html").exists()
        assert "window.PATENT_API_BASE || ''" in (dest / "patent/assets/patent.js").read_text()
        assert "https://" + HOST in (dest / "assets/rv-support-context.js").read_text()
        assert "default_server" not in config(True)
        assert LINK.name > "zarinpal-proxy"
        assert "zarinpal" not in config(True)
        assert "proxy_ssl_verify on;" in config(True)
        print(json.dumps({"static_copy_check": "passed", "public_assets": count,
                          "private_code_excluded": True, "production_source_unchanged": True}))


if __name__ == "__main__":
    mode = MODE
    if mode in ("check", "live-check"):
        check()
    elif mode in ("bootstrap", "https", "live-bootstrap", "live"):
        install(mode in ("https", "live"))
    else:
        raise SystemExit("Modes: check | bootstrap | https")
