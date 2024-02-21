/**
 * 
 * @param {string} str 
 * @param {RegExp} separator 
 * @returns {Array<{value: string, index: number}>}
 */
function splitWithIndex(str, separator) {
    const result = [];
    let match, lastIndex = 0;

    // 使用matchAll获取所有匹配项及其索引
    const regex = new RegExp(separator, separator.flags.includes('g') ? separator.flags : 'g' + separator.flags);
    const matches = [...str.matchAll(regex)];

    if (matches.length === 0) {
        // 没有匹配项时直接返回整个字符串
        return [{ value: str, index: 0 }];
    }

    // 如果字符串以分隔符开始，添加一个空字符串和其索引
    if (matches.length > 0 && matches[0].index === 0) {
        result.push({ value: '', index: 0 });
    }

    for (match of matches) {
        if (match.index !== lastIndex) {
            result.push({ value: str.substring(lastIndex, match.index), index: lastIndex });
        }

        // 捕获组处理（如果分隔符包含捕获组）
        if (match.length > 1) {
            for (let i = 1; i < match.length; i++) {
                result.push({ value: match[i], index: match.index });
            }
        }

        lastIndex = match.index + match[0].length;
    }

    result.push({ value: str.substring(lastIndex), index: lastIndex });

    return result;
}

module.exports = splitWithIndex;