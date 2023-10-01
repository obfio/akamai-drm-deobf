const fs = require('fs');
const t = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const {
    readFileSync,
    writeFileSync,
} = require("fs");
const {
    exit
} = require('process');
var output = ""
let beautify_opts = {
    comments: true,
    minified: false,
    concise: false,
}

const script = readFileSync('./source/drm.js', 'utf-8');

let AST = parser.parse(script, {})

const hexToAsciiVisitor = {
    NumericLiteral(path) {
        delete path.node.extra.raw;
    },
    StringLiteral(path) {
        delete path.node.extra.raw;
    }
}

// ! k0ar => push
let map = []

const doFirstCallExpr = {
    CallExpression(path) {
        const {
            node
        } = path;
        if (!node.callee || node.callee.type != "Identifier" || !node.arguments || node.arguments.length != 1) {
            return
        }
        let bindings = path.scope.getBinding(node.callee.name)
        if (!bindings) {
            return
        }
        let tempAST = parser.parse(generate(bindings.path.node).code)
        traverse(tempAST, controlFlow)
        traverse(tempAST, replaceConstantSub)
        traverse(tempAST, cleanupCringe)
        let mapFuncName = ""
        for (var i = 0; i < tempAST.program.body[0].body.body.length; i++) {
            var n = tempAST.program.body[0].body.body[i]
            if (mapFuncName == "" && n.type == "VariableDeclaration" && !!n.declarations && n.declarations.length == 1 && !!n.declarations[0].init && n.declarations[0].init.type == "FunctionExpression") {
                mapFuncName = n.declarations[0].id.name
                continue;
            }
            if (mapFuncName != "" && n.type == "ExpressionStatement" && !!n.expression && n.expression.type == "CallExpression" && !!n.expression.callee && n.expression.callee.name == mapFuncName) {
                map.push([n.expression.arguments[3].value, n.expression.arguments[1].value])
                continue;
            }
        }
        bindings.path.remove()
        path.remove()
        path.stop()
    }
}

function getMapReplace(origName) {
    var output = {
        replace: false,
        value: "",
    }
    for (var i = 0; i < map.length; i++) {
        if (map[i][0] == origName) {
            return output.replace = true, output.value = map[i][1], output
        }
    }
    return output
}

const replaceMappedFuncs = {
    Identifier(path) {
        const {
            node
        } = path;
        if (!node.name) {
            return
        }
        let mapReplace = getMapReplace(node.name)
        if (!mapReplace.replace) {
            return
        }
        output += `replacing ${generate(node).code} with ${mapReplace.value}\n`
        path.replaceWith(t.identifier(mapReplace.value))
    }
}

const replaceConstantSub = {
    VariableDeclaration(path) {
        path.scope.crawl()
        const {
            node
        } = path;

        if (!node.declarations || node.declarations.length != 1 || node.declarations[0].type != "VariableDeclarator" || !node.declarations[0].id || !node.declarations[0].init || node.declarations[0].id.type != "Identifier" || node.declarations[0].init.type != "ArrayExpression" || !node.declarations[0].init.elements || node.declarations[0].init.elements.length != 1 || node.declarations[0].init.elements[0].type != "Identifier" || node.declarations[0].init.elements[0].name != "arguments") {
            return
        }
        let bindings = path.scope.getBinding(node.declarations[0].id.name)
        if (!bindings) {
            return
        }
        // ! first we're gonna do references to the arguments, this is just easiest
        for (var i = 0; i < bindings.referencePaths.length; i++) {
            let refPath = bindings.referencePaths[i]
            if (!refPath.parentPath.parentPath || !refPath.parentPath.parentPath.node || refPath.parentPath.parentPath.node.type != "MemberExpression" || refPath.parentPath.node.property.value != 0) {
                continue
            }
            refPath.parentPath.parentPath.replaceWith(path.parentPath.parentPath.node.params[refPath.parentPath.parentPath.node.property.value])
        }
        path.scope.crawl()
        bindings = path.scope.getBinding(node.declarations[0].id.name)
        let arr = []
        // ! now we populate our array
        for (var i = 0; i < bindings.referencePaths.length; i++) {
            let refPath = bindings.referencePaths[i]
            if (!!refPath && refPath.parentPath.parentPath.node.type == "AssignmentExpression") {
                let refNode = refPath.parentPath.parentPath.node
                // ! s2sG[5] += Z2sG[1]; when on Z2sG thread, this sets Z2sG[5] (boolean false) to Z2sG[5] += Z2sG[1] (d) aka "falsed"
                if (refNode.left.object.type == "Identifier" && refNode.left.object.name != node.declarations[0].id.name) {
                    continue
                }

                // ! first we handle edge cases, anything not MemberExpression, StringLiteral, BooleanLiteral, or NumericLiteral
                if (refNode.right.type != "StringLiteral" && refNode.right.type != "MemberExpression" && refNode.right.type != "NumericLiteral" && refNode.right.type != "BooleanLiteral") {
                    if (refNode.right.type == "ObjectExpression" && generate(refNode.right).code == "{}") {
                        arr[refNode.left.property.value] = {
                            isNode: true,
                            node: refNode.right
                        }
                        refPath.parentPath.parentPath.remove()
                        continue
                    }
                    // ! be careful with these lol
                    if (refNode.right.type == "ObjectExpression") {
                        continue
                    }
                    arr[refNode.left.property.value] = {
                        isNode: true,
                        node: refNode.right
                    }
                    refPath.parentPath.parentPath.remove()
                    continue
                }
                // ! now we handle MemberExpression
                if (refNode.right.type == "MemberExpression") {
                    i++
                    // ! [Z2sG[7], Z2sG[7].prototype][J2sG], just treat it how we treat the edge cases above?
                    if (refNode.right.object.type != "Identifier") {
                        arr[refNode.left.property.value] = {
                            isNode: true,
                            node: refNode.right
                        }
                        refPath.parentPath.parentPath.remove()
                        continue
                    }
                    if (refNode.left.object.type != "Identifier") {
                        continue
                    }
                    if (refNode.operator == "+=") {
                        arr[refNode.left.property.value].value += arr[refNode.right.property.value].value
                        refPath.parentPath.parentPath.remove()
                        continue
                    }
                    arr[refNode.left.property.value] = {
                        isNode: false,
                        value: arr[refNode.right.property.value].value
                    }
                    refPath.parentPath.parentPath.remove()
                    continue
                }
                // ! now the rest
                if (refNode.operator == "+=") {
                    arr[refNode.left.property.value].value += refNode.right.value
                    refPath.parentPath.parentPath.remove()
                    continue
                }
                arr[refNode.left.property.value] = {
                    isNode: false,
                    value: refNode.right.value
                }
                refPath.parentPath.parentPath.remove()
                continue
            }
        }
        // ! this code is pretty bad but since this only gets ran one time, it doesn't really matter
        path.scope.crawl()
        bindings = path.scope.getBinding(node.declarations[0].id.name)
        for (var i = 0; i < bindings.referencePaths.length; i++) {
            let refPath = bindings.referencePaths[i]
            refNode = refPath.parentPath.parentPath.parentPath.node
            // ! this is just for adding shit to objects
            if (refPath.parentPath.parentPath.parentPath.type == "AssignmentExpression" && refNode.left.property.type == "Identifier" && !refNode.left.computed) {
                arr[refNode.left.object.property.value].node.properties.push(t.objectProperty(refNode.left.property, refNode.right))
                refPath.parentPath.parentPath.parentPath.remove()
                continue
            }
        }
        // ! again, bad code, but it only runs once
        // ! this section replaces everything
        for (var j = 0; j < 3; j++) {
            path.scope.crawl()
            bindings = path.scope.getBinding(node.declarations[0].id.name)
            for (var i = 0; i < bindings.referencePaths.length; i++) {
                let refPath = bindings.referencePaths[i]
                let refNode = refPath.parentPath.node
                if (!refNode || refNode.type != "MemberExpression" || refNode.property.type != "NumericLiteral" || !arr[refNode.property.value]) {
                    continue
                }

                let prop = arr[refNode.property.value]
                if (prop.isNode) {
                    refPath.parentPath.replaceWith(prop.node)
                    continue
                }
                refPath.parentPath.replaceWith(t.valueToNode(prop.value))
            }
        }
        path.remove()
    }
}

// ! makes (0, x) into x
const cleanupCringe = {
    SequenceExpression(path) {
        path.scope.crawl()
        const {
            node
        } = path;
        if (!node.expressions || node.expressions.length != 2) {
            return
        }
        if (node.expressions[0].type != "NumericLiteral" || node.expressions[1].type != "Identifier") {
            return
        }
        output += `set ${generate(node).code} to ${generate(node.expressions[1]).code}\n`
        path.replaceWith(node.expressions[1])
    }
}
const controlFlow = {
    SwitchStatement(path) {
        const {
            node
        } = path;
        if (!node.cases || node.cases.length < 1 || !node.discriminant || node.discriminant.type != "Identifier") {
            return;
        }
        let valid = true
        let isShiftSwitch = false
        let casesOrganized = {}
        for (let i = 0; i < node.cases.length; i++) {
            let n = node.cases[i]
            if (n.type != "SwitchCase" || !n.test || n.test.type != "NumericLiteral" || !n.consequent || n.consequent.length < 1) {
                valid = false
                break
            }
            casesOrganized[n.test.value] = n
            // ! here we're going to use decodeFuncNames to see if this switch is our shiftSwitch
            if (valid && !isShiftSwitch) {
                n = generate(n).code
                for (var j = 0; j < decodeFuncNames.length; j++) {
                    if (n.includes(`${objName}.${decodeFuncNames[j]}(`)) {
                        isShiftSwitch = true
                    }
                }
            }
        }
        if (!valid) {
            return
        }
        let bindings = path.scope.getBinding(node.discriminant.name)
        if (!bindings) {
            return
        }
        let forStatementPath = bindings.referencePaths[0].parentPath
        if (forStatementPath.node.type != "BinaryExpression" || !bindings.path || !bindings.path.node || !bindings.path.node.init || !bindings.path.node.init.value) {
            return
        }
        let caseNumber = bindings.path.node.init.value
        let caseNumberName = bindings.path.node.id.name
        if (!forStatementPath || !forStatementPath.node || !forStatementPath.node.right || !forStatementPath.node.right.value) {
            return
        }
        let breakNumber = forStatementPath.node.right.value
        output += `TRYING TO BREAK SWITCH:\n ${generate(node).code}\nisShiftCase: ${isShiftSwitch}\n`
        writeFileSync("output.txt", output, 'utf-8')
        let obj = getBody({
            isShiftCase: isShiftSwitch,
            currNestPos: 0,
            sourceNodeHistory: [],
            caseNumber: caseNumber,
            breakNumber: breakNumber,
            caseNumberName: caseNumberName,
            initPath: path,
            forStatementPath: forStatementPath,
            casesOrganized: casesOrganized
        })
        forStatementPath.parentPath.replaceWithMultiple(obj.body)
        bindings.path.remove()
    }
}

function existsInArray(arr, compare) {
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] == compare && i != arr.length - 1) {
            return true
        }
    }
    return false
}
var shiftGlobalNum = 0

function shiftGetResult(node1, node2, operator) {
    if (node1.type == "CallExpression") {
        node1 = shiftGlobalNum++
    } else {
        node1 = node1.value
    }
    if (node2.type == "CallExpression") {
        node2 = shiftGlobalNum++
    } else {
        node2 = node2.value
    }
    switch (operator) {
        case "<=":
            return node1 <= node2
        case "<":
            return node1 < node2
        case ">=":
            return node1 >= node2
        case ">":
            return node1 > node2
        case "==":
            return node1 == node2
        case "===":
            return node1 === node2
        case "!=":
            return node1 != node2
        case "!==":
            return node1 !== node2
        default:
            exit(2838)
    }
}

/*
foldingObj:
{
    caseNumber: 1,
    breakNumber: 1,
    caseNumberName: "asd",
    initPath: *path,
    forStatementPath: *path,
    casesOrganized: {1: *Node},
    body: [*Node, *Node],

    wouldStop: true,
    currNestPos: 0, // depth of recursion 
    sourceNodeLoc: 0, // start of loop
    sourceNodeHistory: [0, 1, 2],
    forceStopped: false,
    wasIfStatement: false,
    isShiftCase: false, 
    lastVisited: "asd" // debug
}
*/
function getBody(foldingObj) {
    if (foldingObj.currNestPos > 10) {
        console.log("STOPPING CAUSE INFINITE LOOP IS WEIRD")
        exit(999)
    }
    let body = []
    for (; foldingObj.caseNumber !== foldingObj.breakNumber;) {
        let n = foldingObj.casesOrganized[foldingObj.caseNumber];
        for (let i = 0; i < n.consequent.length; i++) {
            let bodyPiece = n.consequent[i]
            // ! deal with setting caseNumber in normal cases
            if (bodyPiece.type == "ExpressionStatement" && !!bodyPiece.expression && bodyPiece.expression.type == "AssignmentExpression" && !!bodyPiece.expression.left && !!bodyPiece.expression.right && bodyPiece.expression.left.type == "Identifier" && bodyPiece.expression.left.name == foldingObj.caseNumberName && bodyPiece.expression.right.type == "NumericLiteral") {
                foldingObj.lastVisited = "exprStmt"
                // ! now we just set caseNumber and continue, don't add to body
                foldingObj.caseNumber = bodyPiece.expression.right.value
                continue
            }
            // ! deal with setting caseNumber is special case of `ConditionalExpression`
            if (bodyPiece.type == "ExpressionStatement" && !!bodyPiece.expression && bodyPiece.expression.type == "AssignmentExpression" && !!bodyPiece.expression.left && !!bodyPiece.expression.right && bodyPiece.expression.left.type == "Identifier" && bodyPiece.expression.left.name == foldingObj.caseNumberName && bodyPiece.expression.right.type == "ConditionalExpression") {
                // ! handle string shift cff
                if (foldingObj.isShiftCase) {
                    foldingObj.caseNumber = shiftGetResult(bodyPiece.expression.right.test.left, bodyPiece.expression.right.test.right, bodyPiece.expression.right.test.operator) ? bodyPiece.expression.right.consequent.value : bodyPiece.expression.right.alternate.value;
                    continue
                }
                // ! here we will do our check for infinite loop
                if (bodyPiece.start == foldingObj.sourceNodeLoc) {
                    foldingObj.lastVisited = "loopFound"
                    foldingObj.wouldStop = false
                    foldingObj.caseNumber = foldingObj.breakNumber
                    foldingObj.forceStopped = true
                    break
                }
                // ! if statement inside for statement edge case
                if (foldingObj.sourceNodeHistory.length >= 2 && existsInArray(foldingObj.sourceNodeHistory, bodyPiece.start)) {
                    foldingObj.lastVisited = "ifEdge"
                    foldingObj.caseNumber = foldingObj.breakNumber
                    foldingObj.forceStopped = true
                    foldingObj.wouldStop = true
                    break
                }
                // ! create an if else statement that uses bodyPiece.test and evaluates the 2 possible cases for the outputs
                // ! first do consequent
                foldingObj.sourceNodeHistory.push(bodyPiece.start)
                let consequentObj = getBody({
                    t: "c",
                    sourceNodeHistory: [...foldingObj.sourceNodeHistory],
                    sourceNodeLoc: bodyPiece.start,
                    currNestPos: foldingObj.currNestPos + 1,
                    caseNumber: bodyPiece.expression.right.consequent.value,
                    breakNumber: foldingObj.breakNumber,
                    caseNumberName: foldingObj.caseNumberName,
                    initPath: foldingObj.initPath,
                    forStatementPath: foldingObj.forStatementPath,
                    casesOrganized: foldingObj.casesOrganized
                })
                // ! now do alternate

                let alternateObj = getBody({
                    t: "a",
                    sourceNodeHistory: [...foldingObj.sourceNodeHistory],
                    sourceNodeLoc: bodyPiece.start,
                    currNestPos: foldingObj.currNestPos + 1,
                    caseNumber: bodyPiece.expression.right.alternate.value,
                    breakNumber: foldingObj.breakNumber,
                    caseNumberName: foldingObj.caseNumberName,
                    initPath: foldingObj.initPath,
                    forStatementPath: foldingObj.forStatementPath,
                    casesOrganized: foldingObj.casesOrganized
                })
                // ! now we add an if else statement to the body
                if (consequentObj.wouldStop || (consequentObj.wouldStop == undefined && (!!consequentObj.wasIfStatement && !!alternateObj.wasIfStatement))) {
                    foldingObj.lastVisited = "ifNoEdge"
                    body.push(t.ifStatement(bodyPiece.expression.right.test, t.blockStatement(consequentObj.body), t.blockStatement(alternateObj.body)))
                    foldingObj.caseNumber = foldingObj.breakNumber
                    foldingObj.forceStopped = true
                    foldingObj.wasIfStatement = true
                    break;
                }
                // ! edge case `h0Je = 38 ? 68 : 67`, this looks like dead code, can just see if consequentObj.body.length == 0
                if (consequentObj.body.length == 0) {
                    foldingObj.lastVisited = "deadcode"
                    for (var j = 0; j < alternateObj.body.length; j++) {
                        body.push(alternateObj.body[j])
                    }
                    foldingObj.caseNumber = foldingObj.breakNumber
                    foldingObj.forceStopped = true
                    break
                }
                // ! to detect a for statement, we will see if the final body is an `i++`
                if (!!consequentObj.body[consequentObj.body.length - 1].expression && consequentObj.body[consequentObj.body.length - 1].expression.type == "UpdateExpression" && consequentObj.body[consequentObj.body.length - 1].expression.operator == "++") {
                    // ! var i = 0 is body array .length -1, should be previous node
                    // ! test is the bodyPiece.expression.right.test
                    // ! for body should always be the consequent? I hope so anyways lmao
                    foldingObj.lastVisited = "for"
                    var init = body[body.length - 1]
                    if (init.type == "ExpressionStatement") {
                        init = init.expression
                    }
                    body[body.length - 1] = t.forStatement(init, bodyPiece.expression.right.test, consequentObj.body.pop().expression, t.blockStatement(consequentObj.body))
                    for (var j = 0; j < alternateObj.body.length; j++) {
                        body.push(alternateObj.body[j])
                    }
                    foldingObj.caseNumber = foldingObj.breakNumber
                    foldingObj.forceStopped = true
                    break
                }
                // ! while statement
                // ! test is the bodyPiece.expression.right.test
                // ! for body should always be the consequent? I hope so anyways lmao
                foldingObj.lastVisited = "while"
                body.push(t.whileStatement(bodyPiece.expression.right.test, t.blockStatement(consequentObj.body)))
                for (var j = 0; j < alternateObj.body.length; j++) {
                    body.push(alternateObj.body[j])
                }
                foldingObj.caseNumber = foldingObj.breakNumber
                foldingObj.forceStopped = true
                break
            }
            // ! deal with using `return` instead of `caseNumber === breakNumber` as way of exiting
            if (bodyPiece.type == "ReturnStatement") {
                foldingObj.lastVisited = "return"
                body.push(bodyPiece)
                foldingObj.caseNumber = foldingObj.breakNumber
                foldingObj.wouldStop = true
                break;
            }
            if (bodyPiece.type == "ThrowStatement") {
                foldingObj.lastVisited = "throw"
                body.push(bodyPiece)
                foldingObj.caseNumber = foldingObj.breakNumber
                foldingObj.wouldStop = true
                break;
            }
            // ! deal with `break;`
            if (bodyPiece.type == "BreakStatement") {
                foldingObj.lastVisited = "break"
                break;
            }
            body.push(bodyPiece)
        }
    }
    if (!foldingObj.forceStopped && foldingObj.caseNumber == foldingObj.breakNumber) {
        foldingObj.wouldStop = true
    }
    return foldingObj.body = body, foldingObj
}

const JSScrambler = require("./decodeStrings")
var stringDecoder;
let objName = "";
let decodeFuncNames = []
let decodeFuncNodes = []
let deadcodeFuncNames = []

const buildStringDecoder = {
    AssignmentExpression(path) {
        const {
            node
        } = path;
        if (node.operator != "=" || !node.left || node.left.type != "MemberExpression" || !node.right || node.right.type != "Identifier") {
            if (!stringDecoder) {
                if (!!node.left && node.left.type == "MemberExpression" && objName == "") {
                    objName = node.left.object.name
                }
                return
            }
            return
        }
        if (node.left.object.name != objName) {
            return
        }
        let bindings = path.scope.getBinding(node.right.name)
        if (!bindings) {
            return
        }
        stringDecoder = new JSScrambler.jss()
        stringDecoder.setStarterStr(bindings.path.node.body.body[0].argument.value)
        bindings.path.remove()
        path.remove()
    }
}

const getDecodeFuncNames = {
    AssignmentExpression(path) {
        const {
            node
        } = path;
        if (!node.left || !node.right || node.left.type != "MemberExpression" || node.left.object.type != "Identifier" || node.left.object.name != objName || node.left.computed || node.right.type != "FunctionExpression" || node.right.body.body.length != 1 || node.right.body.body[0].type != "ReturnStatement") {
            return;
        }
        // ! this doesn't confirm we have it, this just says we have something similar
        output += "POSSIBLE DECRYPT FUNC: " + node.left.property.name + "\n"
        decodeFuncNames.push(node.left.property.name)
        decodeFuncNodes.push(generate(node.right).code)
        path.remove()
    }
}

const getShifterStr = {
    AssignmentExpression(path) {
        const {
            node
        } = path;
        if (!generate(node).code.includes(`.push(String.fromCharCode(`)) {
            return
        }
        // ! B8DD[297] = function () { ... }()
        stringDecoder.setShifterStr(node.right.callee.body.body[0].declarations[0].init.properties[0].value.arguments[0].value)
        // ! we can use regex to get split str and splice ints
        let n = generate(node).code
        stringDecoder.setSplitStr(/\.split\(".{1,10}"\);/g.exec(n)[0].split('"')[1])
        let res = [...n.matchAll(/[A-z0-9]+\.unshift\.apply\([A-z0-9]+, [A-z0-9]+\.splice\((-|)[0-9]+, (-|)[0-9]+\)\.splice\((-|)[0-9]+, (-|)[0-9]+\)/g)]
        for (var i = 0; i < res.length; i++) {
            var ints = []
            var parts = res[i][0].split(".splice(")
            ints.push(parseInt(parts[1].split(", ")[0]))
            ints.push(parseInt(parts[1].split(", ")[1].replace(")", "")))
            ints.push(parseInt(parts[2].split(", ")[0]))
            ints.push(parseInt(parts[2].split(", ")[1].replace(")", "")))
            stringDecoder.addSpliceInts(ints)
        }
        stringDecoder.doInit()
        // ! confirm decrypt func names here
        let arr = []
        for (var i = 0; i < decodeFuncNodes.length; i++) {
            if (decodeFuncNodes[i].includes(node.right.callee.body.body[0].declarations[0].init.properties[0].key.name)) {
                arr.push(decodeFuncNames[i])
            } else {
                deadcodeFuncNames.push(decodeFuncNames[i])
            }
        }
        decodeFuncNames = arr
        path.remove()
        path.stop()
    }
}

const decodeStrings = {
    CallExpression(path) {
        const {
            node
        } = path;
        if (!node.callee || node.callee.type != "MemberExpression" || node.callee.object.type != "Identifier" || node.callee.property.type != "Identifier" || node.callee.computed || !decodeFuncNames.includes(node.callee.property.name) || !node.arguments || node.arguments.length != 1 || node.arguments[0].type != "NumericLiteral") {
            return
        }
        var o = stringDecoder.decode(node.arguments[0].value)
        output += `${generate(node).code} => ${o}\n`
        path.replaceWith(t.valueToNode(o))
    }
}

const removeDeadCode = {
    CallExpression(path) {
        const {
            node
        } = path;
        if (!node.callee || node.callee.type != "MemberExpression" || node.callee.object.type != "Identifier" || node.callee.property.type != "Identifier" || node.callee.computed || !deadcodeFuncNames.includes(node.callee.property.name)) {
            return
        }
        path.remove()
    },
    AssignmentExpression(path) {
        const {
            node
        } = path;
        if (!generate(node).code.includes(` += true`)) {
            return
        }
        path.remove()
    }
}

const removeUnreferenced = {
    VariableDeclarator(path) {
        const {
            node
        } = path;
        if (!node.init || !node.id || node.init.type != "Identifier" || node.id.type != "Identifier" || node.init.name != objName) {
            return;
        }
        path.scope.crawl()
        let bindings = path.scope.getBinding(node.id.name)
        if (!bindings) {
            return;
        }
        if (!bindings.referencePaths || bindings.referencePaths.length == 0) {
            path.remove()
        }
    }
}

traverse(AST, hexToAsciiVisitor)
traverse(AST, doFirstCallExpr)
traverse(AST, replaceMappedFuncs)
traverse(AST, buildStringDecoder)
traverse(AST, getDecodeFuncNames)
traverse(AST, controlFlow)
traverse(AST, getShifterStr)
output = ""
traverse(AST, decodeStrings)
traverse(AST, removeDeadCode)
traverse(AST, removeUnreferenced)
traverse(AST, cleanupCringe)

writeFileSync("output.txt", output, 'utf-8')

final_code = generate(AST, beautify_opts).code;

fs.writeFileSync('./output/drm.js', final_code);