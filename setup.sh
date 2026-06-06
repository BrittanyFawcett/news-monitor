#!/bin/bash
# Run this once in the Replit Shell to set up the update alias.
# After running, close and reopen the Shell (or run: source ~/.bashrc)

ALIAS_LINE="alias update='pkill node; sleep 2; git pull origin master && npm start'"

if grep -qF "alias update=" ~/.bashrc; then
  echo "update alias already exists in ~/.bashrc — no change made."
else
  echo "$ALIAS_LINE" >> ~/.bashrc
  echo "Added 'update' alias to ~/.bashrc."
  echo "Run:  source ~/.bashrc  (or reopen the Shell) to activate it."
fi
