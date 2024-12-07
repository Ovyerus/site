{
  lib,
  stdenv,
  cacert,
  nodejs_20,
  yarn,
  vips,
  pkg-config,
}: let
  fs = lib.fileset;
in
  stdenv.mkDerivation (finalAttrs: {
    pname = "ovyerus-site";
    version = "2.0.0";
    src = lib.cleanSource ./.;

    nativeBuildInputs = [nodejs_20 yarn vips pkg-config];

    yarnOfflineCache = stdenv.mkDerivation {
      name = "ovyerus-site-deps";
      src = fs.toSource {
        root = ./.;
        fileset = fs.unions [./package.json ./yarn.lock ./.yarn ./.yarnrc.yml];
      };

      nativeBuildInputs = [yarn];

      supportedArchitectures = builtins.toJSON {
        os = ["darwin" "linux"];
        cpu = ["arm" "arm64" "ia32" "x64"];
        libc = ["glibc" "musl"];
      };

      NODE_EXTRA_CA_CERTS = "${cacert}/etc/ssl/certs/ca-bundle.crt";

      configurePhase = ''
        runHook preConfigure
        export HOME="$NIX_BUILD_TOP"
        export YARN_ENABLE_TELEMETRY=0
        yarn config set enableGlobalCache false
        yarn config set cacheFolder $out
        yarn config set supportedArchitectures --json "$supportedArchitectures"
        runHook postConfigure
      '';

      buildPhase = ''
        runHook preBuild
        mkdir -p $out
        yarn install --immutable --mode skip-build
        runHook postBuild
      '';

      dontInstall = true;

      outputHashAlgo = "sha256";
      outputHash = "sha256-RozyKrIvxRk1Hp1xmxIxUGXJJt11Q8B3G+PIF6LuM80=";
      outputHashMode = "recursive";
    };

    configurePhase = ''
      runHook preConfigure

      export HOME="$NIX_BUILD_TOP"
      export YARN_ENABLE_TELEMETRY=0
      yarn config set enableGlobalCache false
      yarn config set cacheFolder $yarnOfflineCache

      runHook postConfigure
    '';

    buildPhase = ''
      runHook preBuild

      yarn install --immutable --immutable-cache
      yarn build

      runHook postBuild
    '';

    installPhase = ''
      cp -r dist $out
    '';
  })
