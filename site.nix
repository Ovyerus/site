{
  lib,
  stdenv,
  cacert,
  nodejs_20,
  yarn,
  vips,
  pkg-config,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "ovyerus-site";
  version = "2.0.0";
  src = ./.;

  # yarnOfflineCache = fetchYarnDeps {
  #   yarnLock = ./yarn.lock;
  #   hash = lib.fakeHash;
  # };
  nativeBuildInputs = [nodejs_20 yarn vips pkg-config];

  yarnOfflineCache = stdenv.mkDerivation {
    # TODO: make this only use package.json & yarn.lock
    name = "ovyerus-site-deps";
    src = ./.;

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
    outputHash = "sha256-THbTR4LVpuE9KC7Bs/muyd6N/qyxWKY6xMZoJVMdKK8=";
    outputHashMode = "recursive";
  };

  # nativeBuildInputs = [yarnConfigHook yarnBuildHook];
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
