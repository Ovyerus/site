{
  dockerTools,
  writeShellScriptBin,
  nodejs_24,
  litefs,
  fuse3,
  bashInteractive,
  cacert,
  runCommand,
  site,
}:
let
  start = writeShellScriptBin "start-site" ''
    exec ${nodejs_24}/bin/node ${site}/scripts/start-fly.mjs "$@"
  '';
  shell = runCommand "fly-shell" {} ''
    mkdir -p "$out/bin"
    ln -s ${bashInteractive}/bin/bash "$out/bin/sh"
  '';
  prepare = writeShellScriptBin "prepare-site-database" ''
    exec ${nodejs_24}/bin/node ${site}/scripts/prepare-database.mjs "$@"
  '';
in
dockerTools.buildLayeredImage {
  name = "ovyerus-site-container";
  tag = "latest";

  # Fly's SSH daemon needs a root account; /etc must also exist before Fly
  # injects resolv.conf, otherwise even internal certificate/DNS lookup fails.
  contents = [nodejs_24 litefs fuse3 bashInteractive cacert dockerTools.fakeNss shell site start prepare];

  # The minimal closure has no base-image filesystem. Node/LiteFS and the
  # bootstrap CLI need a writable temporary directory from the first boot.
  extraCommands = ''
    mkdir -m 1777 tmp
  '';

  config = {
    Cmd = ["${start}/bin/start-site"];
    Env = [
      "PATH=${litefs}/bin:${fuse3}/bin:/bin"
      "NODE_ENV=production"
      "SSL_CERT_FILE=${cacert}/etc/ssl/certs/ca-bundle.crt"
      "NODE_EXTRA_CA_CERTS=${cacert}/etc/ssl/certs/ca-bundle.crt"
    ];
    WorkingDir = "/";
  };
}
