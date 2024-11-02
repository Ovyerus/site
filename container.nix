{
  dockerTools,
  caddy,
  site,
}:
dockerTools.buildLayeredImage {
  name = "ovyerus-site-container";
  tag = "latest";

  config = {
    Cmd = ["${caddy}/bin/caddy" "run" "--adapter" "caddyfile" "--config" "${./Caddyfile}"];
    Env = ["SITE_ROOT=${site}"];
  };
}
