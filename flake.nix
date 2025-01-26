{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = {nixpkgs, ...}: let
    forAllSystems =
      function:
      nixpkgs.lib.genAttrs nixpkgs.lib.systems.flakeExposed (
        system: function nixpkgs.legacyPackages.${system}
      );
    in {
      devShells = forAllSystems (
        pkgs:
          with pkgs;
            mkShell {
              nativeBuildInputs = [nodejs_22 yarn vips pkg-config flyctl];
              shellHook = ''
                export LD_LIBRARY_PATH="${lib.makeLibraryPath [vips]}:$LD_LIBRARY_PATH"
              '';
            }
      );

    packages = forAllSystems (pkgs: let
      site = pkgs.callPackage ./site.nix {};
      container = pkgs.callPackage ./container.nix {inherit site;};
    in {
      inherit site container;
      default = site;
    });
  };
}
