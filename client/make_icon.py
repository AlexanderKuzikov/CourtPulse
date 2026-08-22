from PIL import Image, ImageDraw, ImageFont
import os

def create_ico(output_path):
    sizes = [16, 32, 48, 256]
    images = []
    
    for size in sizes:
        img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        
        # Background rounded rectangle
        margin = max(1, size // 16)
        r = size // 6
        draw.rounded_rectangle(
            [margin, margin, size - margin, size - margin],
            radius=r,
            fill="#1e3799"
        )
        
        # Draw pulse waveform
        # Points for pulse line
        if size >= 32:
            y_mid = size // 2
            points = [
                (size * 0.15, y_mid),
                (size * 0.35, y_mid),
                (size * 0.45, y_mid - size * 0.3),
                (size * 0.55, y_mid + size * 0.3),
                (size * 0.65, y_mid),
                (size * 0.85, y_mid)
            ]
            draw.line(points, fill="#00d2d3", width=max(1, size // 16))
        else:
            # Simple bar for 16x16
            draw.rectangle([size*0.2, size*0.4, size*0.8, size*0.6], fill="#00d2d3")
            
        images.append(img)
        
    images[0].save(
        output_path,
        format="ICO",
        sizes=[(s, s) for s in sizes],
        append_images=images[1:]
    )
    print(f"Icon saved to {output_path}")

if __name__ == "__main__":
    out = os.path.abspath("icon.ico")
    create_ico(out)
