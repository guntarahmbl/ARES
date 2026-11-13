import io, urllib.request


class Remote(io.RawIOBase):
    def __init__(self, url, size):
        self.url = url
        self.size = size
        self.pos = 0

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = (
            offset
            if whence == 0
            else self.pos + offset
            if whence == 1
            else self.size + offset
        )
        return self.pos

    def read(self, n=-1):
        if n < 0:
            n = self.size - self.pos
        if n == 0:
            return b""
        a = self.pos
        b = min(a + n, self.size) - 1
        req = urllib.request.Request(
            self.url, headers={"User-Agent": "Mozilla/5.0", "Range": f"bytes={a}-{b}"}
        )
        with urllib.request.urlopen(req, timeout=45) as r:
            if r.status != 206:
                raise ValueError("Expected range response")
            data = r.read()
        if len(data) != b - a + 1:
            raise ValueError("Truncated remote zip")
        self.pos += len(data)
        return data
