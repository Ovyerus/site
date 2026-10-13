{
  dockerTools,
  nodejs_24,
  site,
}:
dockerTools.buildLayeredImage {
  name = "ovyerus-site-container";
  tag = "latest";

  contents = [nodejs_24 site];

  config = {
    Cmd = ["${nodejs_24}/bin/node" "${site}/dist/server/entry.mjs"];
    Env = ["HOST=0.0.0.0" "PORT=8080"];
    WorkingDir = "/";
  };
}
