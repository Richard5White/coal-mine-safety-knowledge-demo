import json, struct, wave
from pathlib import Path

root = Path(__file__).resolve().parent.parent
timeline = json.loads((Path(__file__).parent / "voiceover_timeline.json").read_text(encoding="utf-8"))
segments = root / "video_output" / "voiceover_segments"
target = root / "video_output" / "coal-mine-voiceover.wav"
total_seconds = 199.266633

with wave.open(str(segments / "01.wav"), "rb") as first:
    channels, width, rate = first.getnchannels(), first.getsampwidth(), first.getframerate()

master = bytearray(int(total_seconds * rate) * channels * width)
for index, item in enumerate(timeline):
    source = segments / f"{item['id']}.wav"
    with wave.open(str(source), "rb") as reader:
        fmt = (reader.getnchannels(), reader.getsampwidth(), reader.getframerate())
        if fmt != (channels, width, rate):
            raise RuntimeError(f"Audio format mismatch: {source} {fmt}")
        frames = bytearray(reader.readframes(reader.getnframes()))
        duration = reader.getnframes() / rate
    next_start = timeline[index + 1]["start"] if index + 1 < len(timeline) else total_seconds
    available = next_start - item["start"] - 0.25
    status = "OK" if duration <= available else "OVERLAP"
    print(f"{item['id']} start={item['start']:.1f}s duration={duration:.2f}s available={available:.2f}s {status}")
    if duration > available:
        frames = frames[: int(available * rate) * channels * width]
    fade_samples = min(int(rate * 0.025), len(frames) // (channels * width) // 2)
    if width == 2 and fade_samples:
        sample_count = len(frames) // 2
        samples = list(struct.unpack("<" + "h" * sample_count, frames))
        for i in range(fade_samples):
            gain = i / fade_samples
            for c in range(channels):
                samples[i * channels + c] = int(samples[i * channels + c] * gain)
                j = sample_count - 1 - (i * channels + c)
                samples[j] = int(samples[j] * gain)
        frames = bytearray(struct.pack("<" + "h" * sample_count, *samples))
    offset = int(item["start"] * rate) * channels * width
    end = min(len(master), offset + len(frames))
    master[offset:end] = frames[: end - offset]

with wave.open(str(target), "wb") as writer:
    writer.setnchannels(channels); writer.setsampwidth(width); writer.setframerate(rate)
    writer.writeframes(master)
print(target)
