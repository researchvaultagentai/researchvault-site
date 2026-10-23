# Iranian frontend deployment helper

The existing GitHub repository remains the source of truth for the frontend.
The helper supports an isolated preview and a separately guarded production
configuration. The international frontend remains independent.

The installer copies only public frontend assets and excludes backend code,
Pages Functions and Git metadata. It checks existing configuration hashes,
preserves default-vhost ordering, validates nginx syntax, and reloads nginx
gracefully. Existing payment and tunnel configurations are outside its scope.
It does not edit DNS, install packages, accept new account terms, or provide
automatic failover.

Upstream connections use IPv4 through the system resolver while retaining
certificate verification and SNI. A dedicated support origin prevents routing
loops after a frontend migration. Original client addresses are accepted only
from the explicitly trusted reverse proxy and are validated before use.

Local validation:

```sh
python3 -B ops/iran-preview.py check
python3 -B ops/iran-preview.py live-check
node --test test/site-support.test.mjs test/iran-client-ip.test.mjs
```

Before deployment, obtain valid certificates for the intended hosts, verify
support routing and unauthenticated access controls, and test from the intended
client networks. An installed certificate renewal hook handles only the new
website certificates. Payment certificates are outside its scope.

Deploy frontend updates from a reviewed release in this repository. A separate
automatic VPS update pipeline is not included in this change. Public HTTP
response timings alone do not validate authenticated or payment workflows.
