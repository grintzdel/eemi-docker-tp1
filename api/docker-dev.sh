#!/bin/sh
set -e

# nest build --watch vide dist/ au demarrage : on le fait nous-memes avant de lancer
# node, sinon au restart node demarre sur l'ancien dist/ et perd son watcher quand
# le build l'efface.
rm -rf dist

npx nest build --watch &
while [ ! -f dist/main.js ]; do sleep 1; done
sleep 1

exec node --watch dist/main.js
