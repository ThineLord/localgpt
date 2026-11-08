"""Deterministic, labeled raster fixtures; never a model or personal image."""
from PIL import Image, ImageDraw, ImageFont
from PIL.PngImagePlugin import PngInfo


def write_png(path, width=512, height=512, color='#a8b8aa', label='Synthetic demo - not model output'):
    image = Image.new('RGB', (width, height), color)
    draw = ImageDraw.Draw(image)
    radius = int(min(width, height) * .17)
    center = (int(width * .7), int(height * .3))
    draw.ellipse((center[0]-radius, center[1]-radius, center[0]+radius, center[1]+radius), fill='#edf0e8')
    draw.polygon([(0, height), (0, int(height*.8)), (int(width*.4), int(height*.45)),
                  (width, int(height*.65)), (width, height)], fill='#365657')
    font = ImageFont.load_default(size=max(12, min(20, width // 30)))
    draw.text((16, height-32), label, fill='white', font=font)
    metadata = PngInfo()
    metadata.add_text('Description', 'Synthetic fixture, not AI model output or personal media')
    image.save(path, format='PNG', pnginfo=metadata)
