This is an annotation tool for quickly creating a labeled dataset of floor plans for panoptic symbol spotting.

The tool is hosted on an AWS EC2 instance (tx3large, eu-central-1a) \[see [fpcadanot438.xyz](https://fpcadanot438.xyz)\]
1. Next.js web-app running on port 3000.
    1. Web app provides an interface to upload data to Cloudflare R2 Object Storage.
2. Computer Vision Annotation Tool ([CVAT](https://www.cvat.ai/)) runs on port 8080
3. Nginx reverse-proxy protects local http web servers and uses CertBot-signed TLS certificates for domain name `fpcadanot438.xyz` (Provider: GoDaddy).
    1. Output of `sudo cat /etc/nginx/sites-available/{cvat.}fpcadanot438.xyz` in `nginx/`
