#!/bin/sh
# apt-get install from the pinned snapshot, retried with backoff.
#
#   sh /usr/local/bin/apt-install <package>...
#
# snapshot.debian.org has outages that last minutes (503 "No healthy backends",
# 504 Gateway Timeout); apt's own Acquire::Retries gives up within seconds, so
# the whole update + install is retried here. A completed attempt installs the
# same packages, so retrying doesn't change what ends up in the image.
set -eu

attempts=6
delay=30
n=1
while :; do
	if apt-get -qq -o Acquire::Check-Valid-Until=false -o Acquire::Retries=5 \
		-o Acquire::http::Timeout=60 update \
		&& DEBIAN_FRONTEND=noninteractive apt-get -qq \
			-o Acquire::Retries=5 -o Acquire::http::Timeout=60 \
			install -y --no-install-recommends "$@"; then
		break
	fi
	if [ "$n" -ge "$attempts" ]; then
		echo "apt-install: giving up after $attempts attempts (snapshot.debian.org unreachable?)" >&2
		exit 100
	fi
	echo "apt-install: attempt $n/$attempts failed, retrying in ${delay}s" >&2
	sleep "$delay"
	n=$((n + 1))
	delay=$((delay * 2))
done
rm -rf /var/lib/apt/lists/*
