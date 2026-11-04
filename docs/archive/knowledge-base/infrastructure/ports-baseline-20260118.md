# Ports baseline (Pi5) - 2026-01-18

This document records a point-in-time baseline of listening ports and firewall rules on the Raspberry Pi 5 host.

## Timestamp

- `2026-01-18T20:59:41+09:00`

## ss -H -tulpen

```
udp UNCONN 0      0                          0.0.0.0:40629 0.0.0.0:* users:(("avahi-daemon",pid=<pid>,fd=14))
udp UNCONN 0      0                          0.0.0.0:111   0.0.0.0:* users:(("rpcbind",pid=<pid>,fd=5),("systemd",pid=<pid>,fd=274))
udp UNCONN 0      0                          0.0.0.0:41641 0.0.0.0:* users:(("tailscaled",pid=<pid>,fd=21))
udp UNCONN 0      0                          0.0.0.0:5353  0.0.0.0:* users:(("avahi-daemon",pid=<pid>,fd=12))
udp UNCONN 0      0                                *:111         *:* users:(("rpcbind",pid=<pid>,fd=7),("systemd",pid=<pid>,fd=278))
udp UNCONN 0      0      [<ipv6-link-local>]:546         *:* users:(("NetworkManager",pid=<pid>,fd=28))
udp UNCONN 0      0                                *:41641       *:* users:(("tailscaled",pid=<pid>,fd=20))
udp UNCONN 0      0                                *:5353        *:* users:(("avahi-daemon",pid=<pid>,fd=13))
udp UNCONN 0      0                                *:43330       *:* users:(("avahi-daemon",pid=<pid>,fd=15))
tcp LISTEN 0      128                        0.0.0.0:22    0.0.0.0:* users:(("sshd",pid=<pid>,fd=6))                            ino:8640 sk:1 cgroup:<cgroup> <->                    
tcp LISTEN 0      4096                       0.0.0.0:80    0.0.0.0:* users:(("docker-proxy",pid=<pid>,fd=7))                  ino:1153296 sk:200f cgroup:<cgroup> <->           
tcp LISTEN 0      4096                       0.0.0.0:111   0.0.0.0:* users:(("rpcbind",pid=<pid>,fd=4),("systemd",pid=<pid>,fd=273)) ino:105 sk:3 cgroup:<cgroup> <->                  
tcp LISTEN 0      4096                     127.0.0.1:631   0.0.0.0:* users:(("cupsd",pid=<pid>,fd=7))                          ino:183501 sk:1001 cgroup:<cgroup> <->              
tcp LISTEN 0      4096                       0.0.0.0:443   0.0.0.0:* users:(("docker-proxy",pid=<pid>,fd=7))                  ino:1154134 sk:2010 cgroup:<cgroup> <->           
tcp LISTEN 0      20                       127.0.0.1:25    0.0.0.0:* users:(("exim4",pid=<pid>,fd=5))                           ino:11696 sk:6 cgroup:<cgroup> <->                 
tcp LISTEN 0      4096                 <tailscale-ipv4>:53596 0.0.0.0:* users:(("tailscaled",pid=<pid>,fd=24))                     ino:10964 sk:8 cgroup:<cgroup> <->            
tcp LISTEN 0      128                           [::]:22       [::]:* users:(("sshd",pid=<pid>,fd=7))                            ino:8644 sk:9 cgroup:<cgroup> v6only:1 <->           
tcp LISTEN 0      4096                          [::]:80       [::]:* users:(("docker-proxy",pid=<pid>,fd=7))                  ino:1153297 sk:2011 cgroup:<cgroup> v6only:1 <->  
tcp LISTEN 0      4096                          [::]:111      [::]:* users:(("rpcbind",pid=<pid>,fd=6),("systemd",pid=<pid>,fd=276)) ino:2362 sk:b cgroup:<cgroup> v6only:1 <->        
tcp LISTEN 0      4096   [<tailscale-ipv6>]:33042    [::]:* users:(("tailscaled",pid=<pid>,fd=25))                     ino:10967 sk:c cgroup:<cgroup> v6only:1 <->   
tcp LISTEN 0      4096                          [::]:443      [::]:* users:(("docker-proxy",pid=<pid>,fd=7))                  ino:1154135 sk:2012 cgroup:<cgroup> v6only:1 <->  
tcp LISTEN 0      16                               *:5900        *:* users:(("wayvnc",pid=<pid>,fd=9))                          uid:985 ino:8828 sk:f cgroup:<cgroup> v6only:0 <->
tcp LISTEN 0      20                           [::1]:25       [::]:* users:(("exim4",pid=<pid>,fd=6))                           ino:11697 sk:10 cgroup:<cgroup> v6only:1 <->       
tcp LISTEN 0      4096                         [::1]:631      [::]:* users:(("cupsd",pid=<pid>,fd=6))                          ino:183500 sk:1002 cgroup:<cgroup> v6only:1 <->     
```

## ufw status verbose

```
Status: active
Logging: on (medium)
Default: deny (incoming), allow (outgoing), deny (routed)
New profiles: skip

To                         Action      From
--                         ------      ----
80/tcp                     ALLOW IN    Anywhere
443/tcp                    ALLOW IN    Anywhere
22/tcp                     ALLOW IN    <lan-subnet-1>
22/tcp                     ALLOW IN    100.64.0.0/10
5900/tcp                   ALLOW IN    <lan-subnet-1>
5900                       ALLOW IN    <lan-subnet-2>
5900/tcp                   ALLOW IN    <lan-subnet-2>
80/tcp (v6)                ALLOW IN    Anywhere (v6)
443/tcp (v6)               ALLOW IN    Anywhere (v6)
```

## docker compose ps (server)

```
NAME           IMAGE                COMMAND                    SERVICE   CREATED             STATUS             PORTS
docker-api-1   docker-api           \"docker-entrypoint.s…\"    api       2 hours ago         Up 2 hours
docker-db-1    postgres:15-alpine   \"docker-entrypoint.s…\"    db        About an hour ago   Up About an hour   5432/tcp
docker-web-1   docker-web           \"sh -c 'if [ -n \\\"$US…\"   web       2 hours ago         Up 2 hours         0.0.0.0:80->80/tcp, [::]:80->80/tcp, 0.0.0.0:443->443/tcp, [::]:443->443/tcp, 443/udp, 2019/tcp
```

