{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = {nixpkgs, ...}: let
    forSystems = fn:
      nixpkgs.lib.genAttrs [
        "aarch64-linux"
        "aarch64-darwin"
        "x86_64-darwin"
        "x86_64-linux"
      ] (system: fn nixpkgs.legacyPackages.${system});
    defaultForSystems = fn: forSystems (pkgs: {default = fn pkgs;});
  in {
    devShells = defaultForSystems (
      pkgs:
        with pkgs;
          mkShell {
            nativeBuildInputs = [nodejs_20 yarn vips pkg-config];
            shellHook = ''
              export LD_LIBRARY_PATH="${lib.makeLibraryPath [vips]}:$LD_LIBRARY_PATH"
            '';
          }
    );

    packages = defaultForSystems (pkgs: pkgs.callPackage ./site.nix {});
  };
}
