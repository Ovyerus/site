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
  src = lib.cleanSource ./.;

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
    hash = "sha256-5QU9wE6oMRw251E32cfo3+0tU3ox7C8aaFFSXRqhadA=";
  };

  buildPhase = ''
    runHook preBuild
    pnpm build
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    cp -r dist $out
    runHook postInstall
  '';
})
