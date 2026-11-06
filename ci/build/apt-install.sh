#!/bin/sh
# apt-get install from the pinned snapshot, retried with backoff.
#
#   sh /usr/local/bin/apt-install <package>...
#
# snapshot.debian.org has outages that last minutes (503 "No healthy backends",
# 504 Gateway Timeout); apt's own Acquire::Retries gives up within seconds, so
# the whole update + download is retried here. It can also trickle bytes so
# slowly that apt's idle timeout never fires and a build sat silent for hours,
# hence the hard `timeout` on every network step. Packages are downloaded first
# and installed afterwards, so a timeout never kills dpkg halfway through.
# A completed attempt installs the same packages, so retrying doesn't change
# what ends up in the image.
set -eu

apt_opts="-o Acquire::Check-Valid-Until=false -o Acquire::Retries=3 -o Acquire::http::Timeout=60"
attempts=6
delay=15
n=1
while :; do
	# -q (not -qq) prints each file as it's fetched, so a stall shows where.
	# shellcheck disable=SC2086
	if timeout -k 10 300 apt-get -q $apt_opts update \
		&& timeout -k 10 900 apt-get -q $apt_opts install -y --no-install-recommends --download-only "$@"; then
		break
	fi
	if [ "$n" -ge "$attempts" ]; then
		echo "apt-install: giving up after $attempts attempts (snapshot.debian.org unreachable?)" >&2
		exit 100
	fi
	echo "apt-install: attempt $n/$attempts failed or timed out, retrying in ${delay}s" >&2
	sleep "$delay"
	n=$((n + 1))
	delay=$((delay * 2))
done
# Everything is in apt's cache now; this step doesn't touch the network.
# shellcheck disable=SC2086
DEBIAN_FRONTEND=noninteractive apt-get -qq $apt_opts install -y --no-install-recommends "$@"
apt-get clean
rm -rf /var/lib/apt/lists/*
