---
title: Moving to Podman from Docker & Docker Compose
description: >
  I recently moved some personal services across machines and decided it would
  be a good excuse to try out Podman instead of Docker. This is a log of what I
  encountered in my move, as a Docker user.
tags: [containers, long]
createdAt: 2023-01-11
modifiedAt: 2023-04-14
---

I have a dedicated server running Proxmox, which I use to provision some virtual
machines for myself and friends. Recently I decided to move a bunch of Docker
services I had running in a LXC container on the host to their own VM, mostly
because I had some problems getting Tailscale working nicely on the container.
While doing this, I also thought it might be a nice excuse to finally give
[Podman](https://github.com/containers/podman) a try.

## The initial move

Installing Podman is pretty simple. I'm using Ubuntu 22.04 so it was already in
the repos so an easy install with APT. It's probably in your distro's
repositories as well.

```
sudo apt install podman
```

One of the cool things about Podman is that it uses the standard fork/exec
technique seen around Unix (instead of a server/client model like Docker), and
the containers are run rootless by default (as the executing user instead). This
means that if you're on a multi-user server, you don't need to give users access
to `sudo docker` or to create a `docker` group for them, and it makes it more
easily auditable if you have the tools for that.

However because Podman is daemon-less, by default if you log out of your session
after starting some containers with it, you'll find that they've mysteriously
disappeared. This is obviously annoying coming from Docker, but thankfully it's
easily solvable with `sudo loginctl enable-linger <username>`, which then lets
them stay around once you log out.

### Using Podman

Moving to Podman from Docker turns out to be really easy. The team has put in a
lot of effort of making the CLI almost one-to-one with Docker, with the same
commands and flags. In fact, for the most part you can just alias `docker` to
`podman`, and carry on with your muscle memory from before.

```
$ podman run --rm docker.io/library/hello-world

Hello from Docker!
This message shows that your installation appears to be working correctly.

<snip>
```

You'll notice that I'm specifying the full name for the image I want to run,
instead of doing the shorthand `hello-world`. By default Podman doesn't expand a
shorthand image to a fully qualified name, but there is a config option for
that. In `/etc/containers/registries.conf` (or
`~/.config/containers/registries.conf`) you can set the option
`unqualified-search-registries` to a list of domains to search through for a
matching image.

```toml
unqualified-search-registries = ["docker.io"]
```

Besides this, Podman acts almost exactly how you would expect Docker would,
which is really cool. Podman also provide their own alternative to Docker
Compose called Podman Compose.

---

## Podman Compose

Podman Compose is easy to get, being in distro repos alongside Podman, and takes
after Docker Compose v1 in the sense that it's a Python CLI script which manages
a group of containers and associated networks & volumes from a single manifest.
For the most common usage you would want from Compose, Podman's is a decent
solution.

I personally have some gripes with some of Podman Compose's behaviour though,
mainly in regards to how `up` works compared to Docker Compose. If you ever need
to update a compose file or the image one of the containers use, usually you
would just run `docker-compose up` and have Compose manage recreating the
related containers for you, however Podman Compose just doesn't do this. Nothing
happens if you try to `up` an already running config, you need to take down the
entire deployment with `docker-compose down` and then run `up` again afterwards,
which is pretty annoying.

Additionally, the logs shown given by it are pretty painful. There's a lot of
noise where it has lines that look like something you would only expect to see
with a debug option enabled. Call me a zoomer, but I much prefer how Docker
Compose hides all that debug logging, and even gives you container labels +
colour coding for each different log stream. It's infinitely easier to
understand what's going on - especially if it's not a service you've made
yourself, where you can't change the log format.

Thankfully, however, you can actually use Docker Compose _natively with Podman_
without needing any weird hacks or doing anything stupid.

## Docker Compose

Yup, that's right! Because of Podman wanting to make it as frictionless as
possible to migrate from Docker, they're actually compatible enough on the
socket to natively support running Docker Compose. I'm going to be using Docker
Compose v2 in this because it has some niceties like `docker-compose ls` and
because it's distributed as a single static Golang binary, making it easy to
download.

Now, Podman only added proper support for Compose v2 in
[v4.1.0](https://github.com/containers/podman/releases/tag/v4.1.0), so let's see
if we have that.

```
$ podman -v
podman version 3.4.4

$ apt info podman
Package: podman
Version: 3.4.4+ds1-1ubuntu1
```

Oh. That's a bit of a problem.

(If you're on a future version of Ubuntu (hopefully 23.04 has the right
version), or on a different/rolling release distro, this following section
probably won't apply to you.)

### Getting the correct Podman version

Yup, it turns out Ubuntu 22.04 just missed out on getting the minimum version we
need in order to be able to use Docker Compose with it. Thankfully however,
since Ubuntu is based on Debian, we can actually yoink an updated `.deb` of the
version we want from their repos. Before that though, we need to install
`libsubid4` for it. I tried with `4.13` from the Debian repos which didn't work
(I forget the exact error I had), so instead I had to fetch `4.11.1` from
Ubuntu's repos and use that, since that's only available from >=22.10 as well.

```
wget https://security.ubuntu.com/ubuntu/pool/main/s/shadow/libsubid4_4.11.1+dfsg1-2ubuntu1.1_amd64.deb
sudo dpkg -i ibsubid4_4.11.1dfsg1-2ubuntu1.1_amd64_1.deb
wget http://ftp.au.debian.org/debian/pool/main/libp/libpod/podman_4.3.1+ds1-5+b1_amd64.deb
sudo dpkg -i podman_4.3.1+ds1-5+b1_amd64.deb
```

```
$ podman -v
podman version 4.3.1
```

Sweet!

NB: after doing this method, I encountered a bit of weirdness due to not having
`containernetworking-plugins`, some sort of packaging error I suppose, but this
was a simple fix by getting it via APT.

### Getting Docker Compose

So now we have a compatible version of Podman, we can turn our attention to
getting Docker Compose. Ubuntu only ships 1.29 for some reason, so we need to v2
manually. Docker provides compiled executables on its
[GitHub releases page](https://github.com/docker/compose/releases) so we can
just pull it from the latest release there.

```
wget https://github.com/docker/compose/releases/download/v2.15.0/docker-compose-linux-x86_64
sudo mv ./docker-compose-linux-x86_64 /usr/bin/docker-compose
```

Simple.

### Using it

Before we can get started with Docker Compose, we first need to fool it into
thinking that Docker actually exists on our system. Usually it would expect a
Docker socket at `unix:///var/run/docker.sock`, but Podman obviously doesn't
provide this, but if a `$DOCKER_HOST` variable is around, Compose will instead
prioritise using that. With this we can simply just pass our rootless Podman
socket as `$DOCKER_HOST` - by default this is at
`unix://$XDG_RUNTIME_DIR/podman/podman.sock`, if you're on the first/sole user
on your system this will probably be `unix:///run/user/1000/podman/podman.sock`
like it was for me. Do double check though!

```fish
set -x DOCKER_HOST unix:///run/user/1000/podman/podman.sock
```

---

#### Edit

One thing I didn't realise at the time of making this post originally, was that
this socket isn't actually created by default. You will need to have Podman
launched as a service so that the socket exists, this can either be done with
the `podman system service` command or just by using systemd.

```
systemctl enable --user podman
systemctl start --user podman
```

---

And with this, we're all set to use Docker Compose as we would if we were just
using normal Docker on our system, with re-running `docker-compose up`
restarting only the necessary containers as we would expect!

---

## Keeping everything running with systemd

Now we have everything running nicely with Podman & Docker Compose. However,
there is one small problem we have right now. When we reboot the machine, our
services don't get brought up on startup. What??

This is due to Podman being a _daemonless_ container runtime, so it has nothing
that is around at startup time which can bring our containers online for us.
Unless we intervene.

If we were using containers we had set up manually, and didn't mind managing a
bunch of different unit files, Podman ships with `podman generate systemd` takes
a container name or ID and spits out a unit file along these lines:

```ini
# container-postgres.service
# autogenerated by Podman 4.3.1
# Sun Jan  8 10:45:24 UTC 2023

[Unit]
Description=Podman container-postgres.service
Documentation=man:podman-generate-systemd(1)
Wants=network-online.target
After=network-online.target
RequiresMountsFor=/run/user/1000/containers

[Service]
Environment=PODMAN_SYSTEMD_UNIT=%n
Restart=on-failure
TimeoutStopSec=60
ExecStart=/usr/bin/podman start postgres
ExecStop=/usr/bin/podman stop  \
	-t 0 postgres
ExecStopPost=/usr/bin/podman stop  \
	-t 0 postgres
PIDFile=/run/user/1000/containers/overlay-containers/46d92085dcde44ec376ab13e5a55ee4ad6b87e961934bd881e9b5cbaa204692d/userdata/conmon.pid
Type=forking

[Install]
WantedBy=default.target
```

However, if you're using Compose configs, this can be a lot to manage depending
on how many containers you're managing in each one, and some services might need
a specific start order/conditions to be met in order to start properly. And it's
also just a lot to do when you're wanting to host something like
[Plausible](https://plausible.io/) or [Sentry](https://sentry.io/). So sadly
this isn't much use to us, but it is useful as a head start on creating our own
units.

What I ended up doing was modifying it so that all the unit ends up doing is
starts the `docker-compose up` process with `--detach` so that it isn't
controlling it outright. I do it this way instead of owning the compose process,
it exits after bringing anything up so that if I need to update a config or an
image, I can just do so with the compose CLI (it's just what I prefer). However
if you have a service which exits at any time, by default systemd will consider
it finished andthus run the `ExecStop` command. Thankfully they provide two
options that counter this, making it consider such a service "alive" after it's
finished running: `Type=oneshot` and `RemainAfterExit=yes`.

Knowing this, here is the unit file I came up with to run Docker Compose on
boot:

```ini
[Unit]
Description=Databases compose config
Wants=network-online.target
After=network-online.target
RequiresMountsFor=/run/user/1000/containers

[Service]
Type=oneshot
RemainAfterExit=yes
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="DOCKER_HOST=unix:///run/user/1000/podman/podman.sock"
ExecStart=docker-compose -f /home/ovy/dbs/docker-compose.yml up -d
ExecStop=docker-compose -f /home/ovy/dbs/docker-compose.yml down

[Install]
WantedBy=default.target
```

I'll have this saved as `dbs-compose.service`.

Unfortunately you will still need to create a unit file for each compose config
you have (unless you create something like a shell script which does them for
you), but it's still a lot better than if you had to do it for each container.
An additional note is that if you're using `$PWD` in your compose configs, you
will need to rewrite them to use relative or absolute paths instead, as it will
instead point to some other location - probably the FS root.

To keep in line with the idea of Podman being rootless, I have these run as user
services under systemd, and it also just makes managing them easier in my
opinion. To do this you'll need to put them into `~/.config/systemd/user/` and
then use `systemctl --user` to enable and start them running as your user
account.

```shell
mkdir -p ~/.config/systemd/user
# Copy/create all your unit files in that directory
systemctl --user daemon-reload
# Now to enable & start each service
systemctl --user enable db-compose.service
systemctl --user start db-compose.service
```

Now if you run `systemctl --user status my-compose.service` you should see
something like this:

```
● dbs-compose.service - Databases compose config
     Loaded: loaded (/home/ovy/.config/systemd/user/dbs-compose.service; enabled; v>
     Active: active (exited) since Sun 2023-01-08 02:41:08 UTC; 22h ago
    Process: 696 ExecStart=docker-compose -f /home/ovy/dbs/docker-compose.yml up -d>
   Main PID: 696 (code=exited, status=0/SUCCESS)
        CPU: 78ms

Jan 08 02:40:57 solai systemd[648]: Starting Databases compose config...
Jan 08 02:41:06 solai docker-compose[696]: Container minio  Starting
Jan 08 02:41:06 solai docker-compose[696]: Container postgres  Starting
Jan 08 02:41:07 solai docker-compose[696]: Container minio  Started
Jan 08 02:41:08 solai docker-compose[696]: Container postgres  Started
Jan 08 02:41:08 solai systemd[648]: Finished Databases compose config.
```

Even though we can see the script has exited, it's still being considered as
active thanks to our use of `Type=oneshot` and `RemainAfterExit=yes`. And now
when we reboot our machine, the services will come up automatically without us
needing to intervene!

If you have a compose setup where one config relies on containers another one
manages - for example, a single centralised database setup for other services -
you can utilise systemd's
[`Wants`/`Requires`](https://www.freedesktop.org/software/systemd/man/systemd.unit.html#Wants=)
and
[`After`](https://www.freedesktop.org/software/systemd/man/systemd.unit.html#Before=)
options to make sure they start in the correct order.

---

Overall, the move to Podman was relatively painless. Besides some packaging
unluckiness on Ubuntu's part, it was easy to get up and running coming from
Docker, and the compatibility with existing tools like Docker Compose is a huge
plus too. It would be nice to see Podman Compose to be improved a bit to be up
to par with Docker Compose - at least in regards to re-`up` behaviour and logs -
as it is a good offering, but what's there right now works.

This is the first blog post I've written ever, so let me know how it went, if
there's anything I can improve for future posts, etc. Thanks!
