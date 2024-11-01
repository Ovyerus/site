{
  dockerTools,
  caddy,
  site,
}:
dockerTools.buildLayeredImage {
  name = "ovyerus-site-container";
  tag = "2024";

  config = {
    Cmd = ["${caddy}/bin/caddy" "run" "--adapter" "caddyfile" "--config" "${./Caddyfile}"];
    Env = ["SITE_ROOT=${site}"];
  };
}
