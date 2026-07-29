from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ASSETS.mkdir(exist_ok=True)

SIZE = 512
image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)

draw.rounded_rectangle((18, 18, 494, 494), radius=112, fill="#1E654C")
draw.rounded_rectangle((62, 62, 450, 450), radius=72, fill="#F8F6ED")
draw.rounded_rectangle((91, 91, 421, 421), radius=48, outline="#153E31", width=17)

font = ImageFont.truetype(r"C:\Windows\Fonts\msyhbd.ttc", 230)
label = "屏"
box = draw.textbbox((0, 0), label, font=font)
text_width = box[2] - box[0]
text_height = box[3] - box[1]
draw.text(
    ((SIZE - text_width) / 2, (SIZE - text_height) / 2 - box[1] - 7),
    label,
    font=font,
    fill="#17251F",
)

draw.ellipse((366, 354, 430, 418), fill="#B63B34")

png_path = ASSETS / "icon.png"
ico_path = ASSETS / "icon.ico"
image.save(png_path)
image.save(ico_path, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(png_path)
print(ico_path)
