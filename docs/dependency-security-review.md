# Dependency security review

Base: main 007cf331. PR #2 dfccbb3 is unchanged. This PR must not be merged automatically.

## Minimal patch

- Next 15.5.12 → 15.5.28 (same framework major/minor).
- Pin Next's sharp to 0.35.5: its supported dependency range permits this, but updating Next alone retained vulnerable sharp in the old lock.
- undici 7.26.0 → 7.30.1 (same major). Actual consumers include tool-proxy, image-generation and Tripo proxy helpers. No configuration or endpoint change.
- No audit fix, schema change, production access or model calls.

## Applicability of the original nine package alerts

| Package | Original version | Condition and repository path | Disposition |
| --- | --- | --- | --- |
| next | 15.5.12 | Public App Router/server routes; image optimizer upstream image processing, cache/middleware/DoS advisories have different prerequisites. Netlify adapter may differ; no live exploit test. | Patch exposed framework surface; do not claim every advisory was demonstrably exploitable. |
| sharp | 0.34.5 | Image decoding of attacker-controlled images. Next optimizer path is security-sensitive. A separate ndarray-pixels copy belongs to 3D optimization tooling. | Patch Next copy; retain separate tooling copy pending native-code compatibility/exposure verification. |
| undici | 7.26.0 | Proxy/network handlers actually imported by server routes. Cache/cookie/SOCKS/WS-specific advisories are not all used, but shared HTTP parsing/decompression surfaces justify same-major patch. | Patch. |
| dompurify | 3.3.3 | Advisories require affected sanitization modes/hooks or hostile DOM. No application import/call found; story renderer explicitly does not use DOMPurify. | Retain alert; no demonstrated call path, not an assertion that HTML rendering elsewhere is safe. |
| fflate | 0.8.2 | Malformed ZIP64 can hang unzipSync. Transitive 3D dependency; app backup uses JSZip, cloud backup uses browser decompression. No direct unzipSync call found. | No proved backup exposure; transitive loader reachability remains unverified. |
| nanoid | 3.3.11 | Non-secure/custom generators with invalid sizes. No app call; build dependency. | No demonstrated attacker-controlled size path. Retain. |
| ndarray-pixels | 5.0.1 | Inherits sharp alert; glTF functions used by browser model optimization. Native sharp server-side use is not established by a browser import. | Retain; no forced incompatible override across tooling. |
| postcss | 8.4.31 | Malicious CSS source maps/file loading and unsafe stringify output; used during build. | Trusted repository build inputs; no app runtime PostCSS service found. Retain build-input risk. |
| source-map-js | 1.2.1 | Hostile indexed source-map offsets causing event-loop DoS, transitive CSS tooling. | No public runtime parsing service found; retain build-input risk. |

Package-level audit severity is not an exploitability conclusion. Remaining transitive/native and Netlify-adapter uncertainty prevents an unconditional release clearance. Do not downgrade remaining alerts merely because a direct source import is absent.

## Validation and merge order

Results must be recorded in the Draft PR after testing the final lock, including the combined security patch + unchanged PR #2 tree. Main-only tests do not substitute for IF tests. No paid API calls permitted.

Recommended order after owner approval: security PR first, then PR #2 after a combined-tree build/regression and refreshed preview acceptance. Neither is authorized for merge or production deployment now. Remaining sharp/tooling and build-input risks require explicit review before release.
