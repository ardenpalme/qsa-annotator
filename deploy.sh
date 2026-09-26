#!/bin/zsh
tar czf deploy.tar.gz --directory .next/standalone .
scp -r -i "~/private/qsa.pem" deploy.tar.gz  ubuntu@ec2-63-177-235-74.eu-central-1.compute.amazonaws.com:~/deploy
scp -r -i "~/private/qsa.pem" .next/static  ubuntu@ec2-63-177-235-74.eu-central-1.compute.amazonaws.com:~/deploy/.next/
scp -r -i "~/private/qsa.pem" public  ubuntu@ec2-63-177-235-74.eu-central-1.compute.amazonaws.com:~/deploy
rm deploy.tar.gz 
