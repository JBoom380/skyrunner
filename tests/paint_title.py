"""Paint the title art over the draft A layout with SDXL img2img (ComfyUI API).
Usage: python paint_title.py NAME SEED DENOISE"""
import json
import sys
import time
import urllib.request

API = "http://127.0.0.1:8188"
name, seed, den = sys.argv[1], int(sys.argv[2]), float(sys.argv[3])
POS = ("cinematic film still, 1982 neo-noir cyberpunk science fiction, futuristic megacity alley with huge glowing neon signs and Japanese characters, flying car headlights in the smoggy sky, a lone detective in a long dark trench coat with the collar turned up, "
       "bareheaded with short messy dark hair, standing in a rain-soaked alley at night, a cigarette between his lips, glowing orange cigarette ember at his mouth, curling cigarette smoke, "
       "strong teal rim light from a neon sign on the left, sodium amber haze, wet pavement reflections, steam, heavy smog, "
       "volumetric searchlight, towering megacity buildings with lit windows, moody, dark, high contrast, crushed blacks, "
       "detailed coat folds, short dark hair, face in shadow, masterpiece, sharp focus")
NEG = ("hat, fedora, 1940s, bright, colorful, pink, magenta, readable text, letters, cartoon, anime, text, watermark, logo, signature, hat, fedora, extra limbs, "
       "deformed hands, blurry, lowres, daylight, sunny")
wf = {
    "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "RealVisXL_V5.0_fp16.safetensors"}},
    "2": {"class_type": "LoadImage", "inputs": {"image": "nr_title_base.png"}},
    "3": {"class_type": "ImageScale", "inputs": {"image": ["2", 0], "upscale_method": "lanczos", "width": 768, "height": 1344, "crop": "center"}},
    "4": {"class_type": "VAEEncode", "inputs": {"pixels": ["3", 0], "vae": ["1", 2]}},
    "5": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": POS}},
    "6": {"class_type": "CLIPTextEncode", "inputs": {"clip": ["1", 1], "text": NEG}},
    "7": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["5", 0], "negative": ["6", 0], "latent_image": ["4", 0],
                                               "seed": seed, "steps": 32, "cfg": 6.0, "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": den}},
    "8": {"class_type": "VAEDecode", "inputs": {"samples": ["7", 0], "vae": ["1", 2]}},
    "9": {"class_type": "SaveImage", "inputs": {"images": ["8", 0], "filename_prefix": f"neonrain/{name}"}},
}
req = urllib.request.Request(API + "/prompt", data=json.dumps({"prompt": wf}).encode(), headers={"Content-Type": "application/json"})
resp = json.load(urllib.request.urlopen(req))
if "error" in resp:
    print("ERROR", json.dumps(resp)[:1500]); sys.exit(1)
pid = resp["prompt_id"]; t0 = time.time()
while True:
    time.sleep(2)
    h = json.load(urllib.request.urlopen(f"{API}/history/{pid}"))
    if pid in h:
        st = h[pid].get("status", {})
        if st.get("status_str") == "error":
            print("ERROR", json.dumps(st)[:1500]); sys.exit(1)
        print("done", round(time.time() - t0, 1), "s", [i["filename"] for o in h[pid]["outputs"].values() for i in o.get("images", [])])
        break
