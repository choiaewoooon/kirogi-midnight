# Rebuild the demo reel with narration: each scene lasts as long as its line plus breathing room,
# scenes cross-fade, and each narration segment is placed at its scene's start.
import subprocess
SCENES = ["00-open","01-problem","02-views","03-seal","04-settle","05-attacks","06-audit","07-tests","08-close"]
# (start, end) of each spoken line in audio/narration-raw.wav, from silencedetect (-40 dB, 1.2 s).
# settle is two sentences with a pause between them, so it spans two detected segments.
SEG = [(0.0,5.31),(11.43,24.30),(26.29,39.37),(45.75,54.43),(60.08,77.37),(80.93,89.13),(91.72,99.11),(100.83,108.25),(109.96,115.56)]
LEAD, TAIL, F = 0.7, 1.1, 0.6
dur = [round(LEAD + (e - s) + TAIL, 2) for s, e in SEG]
dur[-1] += 1.5  # hold the last frame
starts, t = [], 0.0
for i, d in enumerate(dur):
    starts.append(round(t, 2)); t += d - F
args = ["ffmpeg","-y","-loglevel","error"]
for n, d in zip(SCENES, dur): args += ["-loop","1","-t",str(d),"-i",f"frames/{n}.png"]
args += ["-i","audio/narration-raw.wav"]
A = len(SCENES)
f, prev, off = "", "0:v", 0.0
for i in range(1, A):
    off = round(off + dur[i-1] - F, 2)
    f += f"[{prev}][{i}:v]xfade=transition=fade:duration={F}:offset={off}[v{i}];"; prev = f"v{i}"
f += f"[{prev}]format=yuv420p,fps=30[vout];"
for i, (s, e) in enumerate(SEG):
    ms = int((starts[i] + LEAD) * 1000)
    f += f"[{A}:a]atrim={s}:{e+0.05},asetpts=PTS-STARTPTS,afade=t=in:d=0.03,afade=t=out:st={e-s-0.02}:d=0.07,adelay={ms}|{ms}[a{i}];"
f += "".join(f"[a{i}]" for i in range(A)) + f"amix=inputs={A}:normalize=0,loudnorm=I=-16:TP=-1.5[aout]"
args += ["-filter_complex", f, "-map","[vout]","-map","[aout]","-c:v","libx264","-preset","slow","-crf","22",
         "-c:a","aac","-b:a","160k","-movflags","+faststart","../docs/kirogi-midnight-demo.mp4"]
subprocess.run(args, check=True)
print("scene durations", dur, "total", round(sum(dur) - F*(A-1), 1))
