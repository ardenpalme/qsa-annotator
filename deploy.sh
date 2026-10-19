#!/usr/bin/env bash
# Upload a local `pnpm build` (standalone output) to the server's ~/deploy.
set -euo pipefail

usage() {
    cat <<EOF
Usage: $0 [-u user] [-p port] [-i identity_file] host

  host  server IP, domain name (e.g. fpcadanot438.xyz) or ~/.ssh/config alias
  -u    SSH user (default: annotator)
  -p    SSH port (default: 2222)
  -i    SSH private key (default: ssh's own, or ~/.ssh/config)
EOF
}

user=annotator
port=2222
ssh_opts=()
while getopts "u:p:i:h" opt; do
    case $opt in
        u) user=$OPTARG ;;
        p) port=$OPTARG ;;
        i) ssh_opts+=(-i "$OPTARG") ;;
        h) usage; exit 0 ;;
        *) usage >&2; exit 2 ;;
    esac
done
shift $((OPTIND - 1))
if [[ $# -ne 1 ]]; then
    usage >&2
    exit 2
fi
dest="$user@$1"

if [[ ! -f .next/standalone/server.js ]]; then
    echo "error: .next/standalone/server.js not found; run 'pnpm build' first" >&2
    exit 1
fi

trap 'rm -f deploy.tar.gz' EXIT
tar czf deploy.tar.gz --directory .next/standalone .
scp -P "$port" "${ssh_opts[@]}" -r deploy.tar.gz public "$dest:~/deploy"
scp -P "$port" "${ssh_opts[@]}" -r .next/static "$dest:~/deploy/.next/"
