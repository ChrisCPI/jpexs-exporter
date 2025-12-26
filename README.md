# jpexs-exporter
An exporter and recolor tool for SWFs.

## How to use

### Prerequisites

* [Node.js](https://nodejs.org/en/)
* [Java](https://www.java.com/en/download/)
* [JPEXS Free Flash Decompiler](https://github.com/jindrapetrik/jpexs-decompiler) (v.24.1.1 nightly build 3364, or higher)
* [Texture Packer](https://www.codeandweb.com/texturepacker) (when opting to automatically pack)

### Installation

1. Install node dependencies.

```console
npm install
```

2. Copy and paste the ".env.example" file, and name it ".env"

3. (Only required when automatically packing) Install TexturePacker in the command line. [See these instructions for how to do that.](https://www.codeandweb.com/texturepacker/documentation/commandline)

### Configuring the .env file

The `.env` file has 4 variables that need set, most of which already have default values.

- `FFDEC` - The path to the primary file to run FFDec through the command line. As per their own documentation, this should be any of these within the directory in which it is installed:
```
       Linux: ffdec or ffdec.sh
      Mac OS: ffdec.sh
     Windows: ffdec-cli.exe or ffdec.bat
        Java: java -jar ffdec.jar
```
- `CANVAS_SIZE` - The size (in pixels) at which to export each frame of the SWF. (This does not affect the scale of the frames, it only crops it.) Default is 400.
- `SCALE_MULTIPLIER` - When the SVG frames are converted into PNG, the exporter will first resize them to be this number multiplied by the `CANVAS_SIZE`, and then scale them down. A higher number may yield better quality, but will use significantly more processing power. Default is 5.
- `PNG_COMPRESSION` - A number from 0-9 to indicate how much to compress each frame PNG. Higher number = more compression. Default is 6.

### Using the exporter

In its most basic form, you can run this command to run the exporter:
```console
npm run export -- path/to/item.swf
```
However, this can take a few arguments:
- `--dontpack` (shorthand `--dp`) - Tells the exporter to not pack the files with TexturePacker. This will also not delete the individual frame PNGs when the process is done.
- `--saveoutput` (shorthand `--so`) - Tells the exporter to not delete the individual frame PNGs when the process is done. Setting `--dontpack` also does this.
- `--outputdir` (shorthand `--od`) - Output the finished texture sheet into this directory instead of in exports/{swf name}/.
- `--sublengths` (shorthand `--sl`) - Define a map of sublengths, to define how many subframes of a particular frame of the SWF to export. This is in the format of "{frame}:{sublength}", each separated by commas. (Example: "`26:24`" will export 24 frames of frame 26.)

Examples:
```console
npm run export -- ../relative/path/to/item.swf --dontpack --sl 8:5,12:4
npm run export -- /absolute/path/to/item.swf --so --od /path/to/desired/directory
```

The exports can be found in the `exports` directory in the root of this repository, where each subdirectory is the SWF name. The individual frame PNGs will always go here, however the directory of the texture sheet can be defined with `--outputdir`/`--od` when running the command.

> [!NOTE]  
> This is ultimately inferior to exporting via Flash, but its up to you how much the fine details of the sprites matter.

> [!NOTE]  
> I would like to someday have this accomodate furniture sprites, however that'd be way way way more difficult to do, and I'm unsure if its even doable with this method.

### Using the recolor tool
The recoloring tool can be used to find and replace specific colors in a SWF.

Run the `recolor` script, passing in the path to the SWF file as an argument:
```console
npm run recolor -- /path/to/item.swf
```

This will launch a CLI-based interaction where you can replace colors. The script will list all of the fill colors that it could find. To replace a color, input a listed hex code OR the number associated with that hex code, followed by the hex code to replace it with.

Examples:
```
4 #FF0000
#00FF00 #123ABC
```

When you are done, simply input "`save`" into the terminal to save the SWF with the new colors.

> [!NOTE]  
> This modifies the SWF in-place, so make sure you have a copy of it if you want to keep the original.

> [!NOTE]  
> Does not currently support different alpha values besides 1.

> [!NOTE]  
> Does not currently support stroke colors or gradients.