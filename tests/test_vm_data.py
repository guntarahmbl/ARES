import hashlib
import io
import json
from zipfile import ZipFile

import pytest

from scripts import restore_vm_data


@pytest.mark.parametrize("valid_hash,path,error", [
    (False, "data/processed/web/basemap.webp", "checksum mismatch"),
    (True, "data/processed/web/../../../outside.txt", "Unexpected dataset path"),
    (True, "server/main.py", "Unexpected dataset path"),
    (True, "data/processed/web/basemap.webp", None),
])
def test_restore_verifies_hash_and_limits_extraction(tmp_path, monkeypatch, valid_hash, path, error):
    stream = io.BytesIO()
    with ZipFile(stream, "w") as archive:
        archive.writestr(path, b"runtime fixture")
    data = stream.getvalue()
    (tmp_path / "deploy").mkdir()
    (tmp_path / "deploy/dataset.json").write_text(json.dumps({
        "bucket": "data", "key": "runtime.zip",
        "sha256": hashlib.sha256(data).hexdigest() if valid_hash else "0" * 64,
    }))
    monkeypatch.setattr(restore_vm_data, "ROOT", tmp_path)
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "account")
    monkeypatch.setenv("CLOUDFLARE_API_TOKEN", "test-token")
    monkeypatch.setattr(restore_vm_data, "urlopen", lambda *args, **kwargs: io.BytesIO(data))
    if error:
        with pytest.raises(ValueError, match=error):
            restore_vm_data.main()
        assert not (tmp_path / "data").exists()
    else:
        restore_vm_data.main()
        assert (tmp_path / path).read_bytes() == b"runtime fixture"
