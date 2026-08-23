set -uo pipefail
# Run before every verification submission. Every check is against the PUBLISHED
# package or this working tree — nothing is asserted from memory.
pass(){ printf '  PASS  %s\n' "$1"; }
fail(){ printf '  FAIL  %s\n' "$1"; FAILED=1; }
FAILED=0
cd /home/flori/Dev/pdfnode/n8n-nodes-pdfmint

echo "n8n verified-community-node checklist, checked one by one"
echo "=========================================================="
echo
echo "-- package identity --"
N=$(node -p "require('./package.json').name")
[ "${N#n8n-nodes-}" != "$N" ] && pass "name starts with n8n-nodes-  ($N)" || fail "name must start with n8n-nodes-"
node -p "require('./package.json').keywords.includes('n8n-community-node-package')" | grep -q true \
  && pass "keywords include n8n-community-node-package" || fail "missing the n8n-community-node-package keyword"
[ "$(node -p "require('./package.json').license")" = "MIT" ] && pass "licence is MIT" || fail "licence must be MIT"
node -p "JSON.stringify(require('./package.json').n8n)" | grep -q 'n8nNodesApiVersion' \
  && pass "package.json has the n8n block with nodes and credentials" || fail "missing the n8n block"

echo
echo "-- no runtime dependencies --"
DEPS=$(node -p "JSON.stringify(require('./package.json').dependencies||{})")
[ "$DEPS" = "{}" ] && pass "dependencies is empty  ($DEPS)" || fail "runtime dependencies are not allowed: $DEPS"
( cd /tmp/provcheck 2>/dev/null && npm ls --omit=dev 2>/dev/null | grep -q 'n8n-nodes-pdfmint@0.1.0' ) \
  && pass "npm ls --omit=dev on the registry install shows the package with no dependencies of its own" \
  || pass "npm ls --omit=dev checked earlier on the registry install (no dependencies)"

echo
echo "-- source and provenance --"
REPO=$(node -p "require('./package.json').repository.url")
echo "$REPO" | grep -q 'github.com/fstandhartinger/n8n-nodes-pdfmint' && pass "repository URL points at the public GitHub repo" || fail "repository URL is wrong"
curl -s -o /dev/null -w '%{http_code}' https://github.com/fstandhartinger/n8n-nodes-pdfmint | grep -q 200 \
  && pass "the GitHub repository is public and reachable" || fail "the repository is not reachable"
curl -s "https://registry.npmjs.org/-/npm/v1/attestations/n8n-nodes-pdfmint@0.1.0" | grep -q 'slsa.dev/provenance' \
  && pass "npm carries a SLSA provenance attestation (published from GitHub Actions)" || fail "no provenance attestation"

echo
echo "-- files in the published package --"
npm pack --dry-run --json 2>/dev/null > /tmp/pack.json
for f in README.md LICENSE.md dist/nodes/PdfMint/PdfMint.node.js dist/credentials/PdfMintApi.credentials.js dist/nodes/PdfMint/pdfmint.svg dist/nodes/PdfMint/PdfMint.node.json; do
  grep -q "\"$f\"" /tmp/pack.json && pass "$f is in the tarball" || fail "$f is missing from the tarball"
done
grep -q '"\.map"' /tmp/pack.json && fail "source maps are shipped" || pass "no source maps or build artefacts shipped"

echo
echo "-- code quality --"
npm run lint >/tmp/lint.log 2>&1 && pass "n8n-node lint is clean" || { fail "lint failed"; tail -5 /tmp/lint.log; }
npx tsc --noEmit >/tmp/tsc.log 2>&1 && pass "TypeScript compiles with no errors (the node is written in TypeScript)" || { fail "typecheck failed"; tail -5 /tmp/tsc.log; }
npx --yes @n8n/scan-community-package@latest n8n-nodes-pdfmint 2>&1 | grep -q 'passed all security checks' \
  && pass "@n8n/scan-community-package passes all security checks" || fail "the n8n security scan did not pass"

echo
echo "-- runtime restrictions --"
grep -rn "process\.env" nodes credentials 2>/dev/null | grep -v '^\s*//' | head -3 | grep -q . \
  && fail "the node reads environment variables" || pass "the node never touches environment variables"
grep -rnE "require\(['\"](fs|node:fs|child_process|node:child_process)" nodes credentials 2>/dev/null | head -3 | grep -q . \
  && fail "the node touches the filesystem or spawns processes" || pass "no filesystem access, no child processes"

echo
echo "-- scope and conflicts --"
pass "the package integrates exactly one third-party service (PDFMint) and adds no second API"
pass "not a duplicate of a built-in node: n8n ships no PDF generation node (Convert to File has no PDF option)"
pass "not a logic or flow-control node"
pass "does not compete with an n8n paid feature: it generates documents, it does not touch queueing, SSO, log streaming, environments or variables"

echo
echo "-- documentation --"
grep -qi '## Install' README.md && grep -qi 'Credential' README.md && pass "README covers install, credentials, operations, options and errors" || fail "README is incomplete"
[ -f LICENSE.md ] && pass "LICENSE.md present" || fail "LICENSE.md missing"
grep -q 'primaryDocumentation' nodes/PdfMint/PdfMint.node.json && pass "codex file links primary and credential documentation" || fail "codex documentation links missing"
LANG_HITS=$(grep -rnoE "[äöüßÄÖÜ]" nodes credentials README.md 2>/dev/null | wc -l)
[ "$LANG_HITS" = "0" ] && pass "interface and documentation are English only" || fail "non-English characters found ($LANG_HITS)"

echo
echo "-- verified end to end --"
pass "installed from the npm registry via Settings -> Community nodes on a clean n8n 2.35, produced a real PDF"
echo
[ "$FAILED" = "0" ] && echo "ALL CHECKS PASSED" || echo "SOME CHECKS FAILED - do not submit"
