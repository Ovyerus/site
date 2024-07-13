---
title: My iOS Shortcut for Obsidian quick capture
description: >
  How I revamped my note-taking in Obsidian with a custom iOS Shortcut, making
  capturing thoughts quick and effortless.
tags: [obsidian, ios, short]
createdAt: 2024-05-24
---

<abbr title="Too long; didn't read">TL;DR</abbr>: Install the
[Actions URI](https://github.com/czottmann/obsidian-actions-uri) extension into
your Obsidian vault, and add this Shortcut:
https://www.icloud.com/shortcuts/7ae0a2589764489cb3cdbc8fe22d9888

---

I've been ~~trying to use~~ using [Obsidian](https://obsidian.md/) since the
start of the year for storing notes and various pieces of writing, but more
recently I've trying to change up how I use it, turning it into more of a proper
second brain. To help with this, I stumbled upon the
[Zettelkasten](https://en.wikipedia.org/wiki/Zettelkasten) method of taking
notes, which involves taking “fleeting notes” for ideas as they come, and then
revisiting them later in the day or week to flesh out into proper “atomic” (or
“permanent”) notes if it's worthy.

> For further reading on Zettelkasten, I highly recommend
> [this article](https://obsidian.rocks/getting-started-with-zettelkasten-in-obsidian/)
> on obsidian.rocks, which really helped me to understand the concept and
> actually applying it inside of Obsidian.

However, in the land of mobile where everything is gesture based, and we don't
have the luxury of superfast keyboard shortcuts, it can often be a bit
troublesome trying to capture our thoughts. Opening the Obsidian app is usually
fine enough, however by default it doesn't open right into a new note, so it's a
few extra steps to get to writing.

Recently though, I picked up an iPhone 15 Pro to replace my old phone, and Apple
has replaced the physical mute switch of yore with a customisable action button,
which can even run Shortcuts! This gave me an idea to create a Shortcut workflow
to pop up a text box immediately, before sending the text off to Obsidian
afterwards.

<figure>
  <video controls>
    <source src="https://cdn.ovy.cloud/blog/obsidian-shortcut-example.mp4" type="video/mp4" />
  </video>
  <figcaption>
    Of course, if you don't have an iPhone with an action button, you can just put it as an
    icon on your homescreen instead.
  </figcaption>
</figure>

It's nothing too fancy, but being able to get a text box summoned out of thin
air is a big plus compared to having to navigate my way to a new note manually.
The Shortcut is available from
[iCloud directly](https://www.icloud.com/shortcuts/7ae0a2589764489cb3cdbc8fe22d9888),
and keep in mind that you will need to add the
[Actions URI](https://github.com/czottmann/obsidian-actions-uri) extension to
your vault.

That link _should_ work indefinitely (at least as long as Shortcuts is still
around), but for posterity here’s an explanation of the steps it goes through to
work.

![Screenshot of the iOS Shortcuts app depicting an overview of the shortcut](https://cdn.ovy.cloud/blog/obsidian-shortcut-overview.png)

1. Show a text box asking for the note content.
2. URL encode the text box input.
3. URL encode the full path & name of the destination file (in this case, it's
   saving to `05 - Fleeting/$DATE` where `$DATE` is the Current Date variable
   formatted using `YYYY-MM-dd+HHmm`).
4. URL encode the name of the destination vault.
5. Put together the variables into the
   [`/note/create`](https://zottmann.dev/obsidian-actions-uri/routes/note/#notecreate)
   actions URI, using the “Open URIs” action.
   (`obsidian://actions-uri/note/create?vault=$VAULT&file=$FILE&content=$TEXTBOX`).

And voilà! A Shortcut for stuffing your thoughts into Obsidian at a moments
notice.
