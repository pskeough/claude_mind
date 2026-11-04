# Claude Mind — Quick Start

This gives Claude Code a memory. It quietly remembers your work and your past Claude
sessions, and reminds Claude of the relevant bits whenever you need them. It runs on
your own computer, on your existing Claude subscription. Nothing leaves your computer.

You only do this once. After that it takes care of itself.

---

## What you need first

- A Mac or a Windows PC.
- **Claude Code** installed and signed in (the same Max account you already use).
- A few minutes.

If a step below mentions something is missing, Claude will tell you the exact thing
to type. You don't have to understand it — just paste what it gives you.

---

## The 4 steps

### 1. Get the files and start the installer

**On a Mac:** open the **Terminal** app and paste these three lines, one at a time
(press Return after each):

```
git clone https://github.com/pskeough/claude_mind.git ~/ClaudeMind
cd ~/ClaudeMind
bash setup.sh
```

**On Windows:** download the folder, put it somewhere permanent (`C:ClaudeMind` is a
good home), open it, and **double-click `setup.bat`**. If Windows warns you about
running it, choose *More info -> Run anyway*.

Either way this downloads everything and prepares it. It takes a few minutes the first
time. Leave the folder where it is; don't move it afterwards.

### 2. Hand it over to Claude

In that same window, still in the folder, type:

```
claude
```

That is all you have to do. Claude Code opens, notices the folder has not been set up,
and starts asking you questions on its own.

(If for some reason it does not, just say: **run setup**.)

### 3. Answer its questions

Claude will ask you a few simple things: your name, how you'd like it to talk to you,
and which folders on your computer hold your work (so it can learn from them). Just answer
naturally.

### 4. Give it your past chats (optional but nice)

If you want it to really know you, Claude will ask you to export your Claude history:
go to **claude.ai → Settings → Privacy → Export data**. You'll get an email with a
file; unzip it and tell Claude where it is. (You can skip this and do it later.)

---

## That's it

Claude finishes the install, turns on the background helpers, and confirms everything
works. From then on it runs by itself. To peek inside it any time, double-click
**`launch.command`** in the folder, or open **http://127.0.0.1:7099** in your browser.

If anything ever seems off, just open Claude Code in the folder and say: **"check
Claude Mind is healthy and fix it."** It knows how (see `docs/verify-and-fix.md`).
