class JSScrambler {
    constructor() {
        this.starterStr = ""
        this.shifterStr = "" // "MG1I8U"
        this.decodedStrings = [] // final output of decoding the strings
        this.num = 0 // globally defined and used in the return function
        this.splitStr = "" // ;_
        this.spliceInts = [] // 2d arr
    }
    setStarterStr(str) {
        this.starterStr = str
    }
    setShifterStr(str) {
        this.shifterStr = str
    }
    setSplitStr(str) {
        this.splitStr = str
    }
    addSpliceInts(arr) {
        this.spliceInts.push(arr)
    }
    doInit() {
        this.starterStr = decodeURI(this.starterStr)
        var decodedStr = ""
        for(var i = 0, j = 0; i < this.starterStr.length; i++, j++) {
            if(j == this.shifterStr.length) {
                j = 0
            }
            decodedStr += String.fromCharCode(this.starterStr.charCodeAt(i) ^ this.shifterStr.charCodeAt(j))
        }
        this.decodedStrings = decodedStr.split(this.splitStr)
        for(var i = 0; i < this.spliceInts.length; i++) {
            var a = this.spliceInts[i]
            this.decodedStrings.unshift.apply(this.decodedStrings, this.decodedStrings.splice(a[0], a[1]).splice(a[2], a[3]));
        }
      }
    decode(num) {
        return this.decodedStrings[num]
    }
}
module.exports.jss = JSScrambler