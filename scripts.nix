{
  ffmpeg,
  writeShellApplication,
}: {
  hls = writeShellApplication {
    name = "ovy-hls";
    runtimeInputs = [ffmpeg];
    text = ''
      args=("$@")
      rawname=''${args[0]%.*}
      ffmpeg \
        -i "''${args[0]}" \
        -filter_complex "[0:v]split=2[v1][v2]; [v1]copy[v1out]; [v2]scale=trunc(iw/4)*2:trunc(ih/4)*2[v2out]" \
        -map "[v1out]" -c:v:0 libx264 -crf 19 -preset slow -g 300 -keyint_min 300 \
        -map "[v2out]" -c:v:1 libx264 -crf 19 -preset slow -g 300 -keyint_min 300 \
        -map a:0 -c:a:0 copy \
        -map a:0 -c:a:1 copy \
        -f hls \
        -hls_time 5 \
        -hls_playlist_type vod \
        -hls_flags independent_segments \
        -hls_segment_type mpegts \
        -hls_segment_filename "$rawname/stream_%v/data%02d.ts" \
        -master_pl_name index.m3u8 \
        -var_stream_map "v:0,a:0 v:1,a:1" "$rawname/stream_%v/stream.m3u8"
    '';
  };

  mp4 = writeShellApplication {
    name = "ovy-mp4";
    runtimeInputs = [ffmpeg];
    text = ''
      args=("$@")
      ffmpeg \
        -i "''${args[0]}" \
        -c:v libx264 -crf 19 -preset slow -g 300 -keyint_min 300 -c:a copy \
        "''${args[0]%.*}_transcode.mp4"
    '';
  };
}
