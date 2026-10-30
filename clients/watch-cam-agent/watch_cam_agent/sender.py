"""Send raw JPEG once, without redirects or a retry queue."""

import ssl
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class HttpClient:
    def __init__(self, config):
        self.config = config
        context = ssl.create_default_context()
        if config.tls_skip_verify:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPSHandler(context=context), NoRedirect(),
        )

    def post(self, frame):
        request = urllib.request.Request(
            self.config.api_base_url + "/api/watch-camera/frames",
            data=frame, method="POST",
            headers={"Content-Type": "image/jpeg", "x-client-key": self.config.x_client_key},
        )
        try:
            with self.opener.open(request, timeout=10) as response:
                return response.status
        except urllib.error.HTTPError as error:
            error.close()
            return error.code

