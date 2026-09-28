#!/bin/zsh
tar czf deploy.tar.gz --directory .next/standalone .
scp -r -i "~/project/private/annotation-server.pem" deploy.tar.gz  ubuntu@ec2-3-121-53-26.eu-central-1.compute.amazonaws.com:~/deploy
scp -r -i "~/project/private/annotation-server.pem" .next/static  ubuntu@ec2-3-121-53-26.eu-central-1.compute.amazonaws.com:~/deploy/.next/
scp -r -i "~/project/private/annotation-server.pem" public ubuntu@ec2-3-121-53-26.eu-central-1.compute.amazonaws.com:~/deploy
rm deploy.tar.gz 
