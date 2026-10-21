#!/bin/zsh
set -eu
cd "${0:A:h}"
if [[ -x .venv/bin/python ]]; then
  exec .venv/bin/python work/chat-sidebar/launch.py
fi
printf '%s\n' 'LocalGPT: create the project .venv and install requirements.txt first (see README).'
exit 1
