{
  lib,
  stdenv,
  nodejs_24,
  pnpm_12,
  pnpmConfigHook,
  fetchPnpmDeps,
  vips,
  pkg-config,
}:
stdenv.mkDerivation (finalAttrs: {
  pname = "ovyerus-site";
  version = "2.0.0";
  src = lib.cleanSourceWith {
    src = ./.;
    filter = path: type:
      let
        name = builtins.baseNameOf (toString path);
      in
        lib.cleanSourceFilter path type
        && !(builtins.elem name [
          ".astro"
          ".direnv"
          ".emdash"
          "emdash-env.d.ts"
          ".jj"
          ".output"
          ".env"
          ".git"
          ".pnpm-store"
          "data"
          "dist"
          "node_modules"
          "result"
        ])
        && !(lib.hasPrefix ".env" name);
  };

  nativeBuildInputs = [nodejs_24 pnpm_12 pnpmConfigHook vips pkg-config];

  pnpmDeps = fetchPnpmDeps {
    pnpm = pnpm_12;
    inherit (finalAttrs) pname version;
    src = lib.fileset.toSource {
      root = ./.;
      fileset = lib.fileset.unions [
        ./package.json
        ./pnpm-lock.yaml
        ./pnpm-workspace.yaml
      ];
    };
    fetcherVersion = 4;
    hash = "sha256-/80uTunrp4Agjzy5qnfBC9Og0ewjASj6t4XVARM7wOY=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p "$out"
    cp -r dist "$out/dist"
    cp package.json pnpm-lock.yaml pnpm-workspace.yaml "$out/"
    pnpm install --prod --offline --frozen-lockfile --frozen-store --ignore-scripts --dir "$out"
    rm "$out/pnpm-lock.yaml" "$out/pnpm-workspace.yaml"
    runHook postInstall
  '';
})
