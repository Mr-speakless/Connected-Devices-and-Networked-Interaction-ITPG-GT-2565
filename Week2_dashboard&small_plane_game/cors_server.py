from http.server import HTTPServer, SimpleHTTPRequestHandler
import sys

import os

class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        SimpleHTTPRequestHandler.end_headers(self)

    def do_GET(self):
        # Optimization: If asking for log.json, only serve the LAST 32KB
        # This prevents the request from getting huge as the game runs longer.
        if self.path.startswith('/log.json'):
            try:
                with open('log.json', 'rb') as f:
                    f.seek(0, os.SEEK_END)
                    filesize = f.tell()
                    seek_dist = min(filesize, 32 * 1024) # Read last 32KB
                    f.seek(-seek_dist, os.SEEK_END)
                    content = f.read()
                
                self.send_response(200)
                self.send_header('Content-type', 'application/json')
                self.send_header('Content-Length', len(content))
                self.end_headers()
                self.wfile.write(content)
                return
            except Exception as e:
                print(f"Error serving log.json: {e}")
                self.send_error(500, str(e))
                return

        # Default behavior for other files
        return SimpleHTTPRequestHandler.do_GET(self)

if __name__ == '__main__':
    port = 8000
    print(f"Starting CORS-enabled server on port {port}...")
    httpd = HTTPServer(('0.0.0.0', port), CORSRequestHandler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
