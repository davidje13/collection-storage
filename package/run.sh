#!/bin/sh
set -e

echo "Running package test...";
echo;

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";
cp "$BASE_DIR/package-"*.tgz "$BASE_DIR/package/";

cd "$BASE_DIR/package";
rm -rf node_modules/collection-storage node_modules/@collection-storage || true;
npm install --audit=false;
rm package-*.tgz || true;
npm -s test;
cd - >/dev/null;

echo;
echo "Package test complete";
echo;
