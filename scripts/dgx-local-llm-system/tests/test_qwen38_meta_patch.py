import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('qwen38_meta_patch', Path(__file__).resolve().parents[1]/'qwen38_meta_patch.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = '''class GDN:
    def __init__(self):
        self.dt_bias = nn.Parameter(torch.ones(4))
        self.norm = RMSNormGated(
            device=current_platform.current_device(),
        )
'''


class MetaPatchTest(unittest.TestCase):
    def test_uses_existing_parameter_device_for_meta_and_cuda(self):
        for device in ('meta', 'cuda:0'):
            namespace = {'nn': SimpleNamespace(Parameter=lambda value: value),
                         'torch': SimpleNamespace(ones=lambda size: SimpleNamespace(device=device)),
                         'RMSNormGated': lambda **kwargs: kwargs['device']}
            # No current_platform provided: the patched constructor must not
            # consult CUDA during PLE's meta-only structure discovery.
            exec(module.patch_source(SOURCE), namespace)
            self.assertEqual(device, namespace['GDN']().norm)
    def test_rejects_unexpected_or_duplicate_source(self):
        for source in ('different version', SOURCE + SOURCE):
            with self.assertRaises(ValueError): module.patch_source(source)


if __name__ == '__main__': unittest.main()
