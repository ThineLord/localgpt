"""Shared validation and image graph; no server or filesystem side effects on import."""
from pathlib import Path
import secrets
try:
    from .lm_chat import clean_options
except ImportError:
    from lm_chat import clean_options

def image_path(image, input_root, output_root, output_only=False):
    if not isinstance(image, dict):
        raise ValueError('Invalid image')
    filename = image.get('filename','')
    kind = image.get('type','output')
    if kind not in (('output',) if output_only else ('input','output')) or not filename or Path(filename).name != filename:
        raise ValueError('Invalid image')
    base = Path(output_root if kind=='output' else input_root).resolve()
    path = (base / image.get('subfolder','') / filename).resolve()
    if not path.is_relative_to(base) or not path.is_file():
        raise ValueError('Image file is missing')
    return path


def clean_draft(draft, input_root, output_root):
    if not isinstance(draft,dict):
        raise ValueError('Invalid draft')
    prompt = draft.get('prompt','')
    if not isinstance(prompt,str) or len(prompt)>4000:
        raise ValueError('Prompt exceeds 4000 characters')
    size = draft.get('size','512,512')
    quality = str(draft.get('quality','25'))
    if size not in ('512,512','640,384','384,640') or quality not in ('15','25'):
        raise ValueError('Invalid settings')
    reference = draft.get('reference')
    if reference:
        image_path(reference, input_root, output_root)
        reference = {k:reference[k] for k in ('filename','subfolder','type') if k in reference}
    return {'prompt':prompt,'reference':reference,'size':size,'quality':quality,**{k:v for k,v in clean_options(draft).items() if k in draft}}


def graph(prompt,width,height,steps,reference,cfg=1,seed=None):
    g = {
        '451':{'class_type':'UnetLoaderGGUF','inputs':{'unet_name':'qwen-image-2.1-UC-Q4_K_M.gguf'}},
        '453':{'class_type':'CLIPLoader','inputs':{'clip_name':'qwen3vl_8b_int8_convrot.safetensors','type':'qwen_image','device':'cpu'}},
        '454':{'class_type':'VAELoader','inputs':{'vae_name':'qwen_image_2.1_vae_bf16.safetensors'}},
        '452':{'class_type':'TextEncodeQwenImage21','inputs':{'clip':['453',0],'prompt':prompt,'negative_prompt':'','resolution':512}},
        '456':{'class_type':'EmptyLatentImage','inputs':{'width':width,'height':height,'batch_size':1}},
        '480':{'class_type':'QwenImage21Cache','inputs':{'model':['451',0],'device':'off','dtype':'default'}},
        '458':{'class_type':'KSampler','inputs':{'model':['480',0],'seed':secrets.randbits(48) if seed is None else seed,'steps':steps,'cfg':cfg,'sampler_name':'euler','scheduler':'simple','positive':['452',0],'negative':['452',1],'latent_image':['456',0],'denoise':1}},
        '457':{'class_type':'VAEDecode','inputs':{'samples':['458',0],'vae':['454',0]}},
        '461':{'class_type':'SaveImage','inputs':{'images':['457',0],'filename_prefix':'Qwen中文生成/编辑' if reference else 'Qwen中文生成/图片'}}}
    if reference:
        path = (reference.get('subfolder','')+'/' if reference.get('subfolder') else '')+reference['filename']
        g['460']={'class_type':'LoadImage','inputs':{'image':path+(' [output]' if reference.get('type')=='output' else '')}}
        g['452']['inputs'].update({'images.image_1':['460',0],'vae':['454',0]})
        g['480']['inputs']['device']='auto'
    return g
