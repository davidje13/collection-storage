#!/bin/sh
set -e

BASE_DIR="$(cd "$(dirname "$0")/.."; pwd)";

echo "Building...";
echo;

VERSION="$1";
MODULES="core dynamodb mongodb postgresql redis sqlite";

for MODULE in $MODULES; do
  rm "$BASE_DIR/package-$MODULE.tgz" 2>/dev/null || true;
done;
rm -rf "$BASE_DIR/build" 2>/dev/null || true;

cd "$BASE_DIR";
npx rollup --config rollup.config.mjs;
cd - >/dev/null;

for MODULE in $MODULES; do
  cp "$BASE_DIR/src/$MODULE/README.md" "$BASE_DIR/LICENSE" "$BASE_DIR/build/$MODULE";
  rm -rf "$BASE_DIR/build/$MODULE/types";
  node \
    -e 'const j=JSON.parse(process.argv[1]);const version=process.argv[2];for(const k of ["private","devDependencies","scripts"])delete j[k];j["version"]=version;j["main"]="index.mjs";j["types"]="index.d.mts";if(process.argv[3]!=="core"){j["peerDependencies"]??={};j["peerDependencies"]["collection-storage"]=version;}process.stdout.write(JSON.stringify(j,null,"\t")+"\n");' \
    "$(cat "$BASE_DIR/src/$MODULE/package.json")" "$VERSION" "$MODULE" \
    > "$BASE_DIR/build/$MODULE/package.json";

  cd "$BASE_DIR/build/$MODULE";
  npm pack;
  cd - >/dev/null;
  mv "$BASE_DIR/build/$MODULE/"*.tgz "$BASE_DIR/package-$MODULE.tgz";
done

rm -rf "$BASE_DIR/build";

echo;
echo "Build complete";
echo;
