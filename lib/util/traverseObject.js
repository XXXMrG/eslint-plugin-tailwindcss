function traverseObject(obj, callback, path = []) {
    Object.keys(obj).forEach(key => {
        const value = obj[key];
        const newPath = path.concat(key);
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            traverseObject(value, callback, newPath);
        } else {
            callback(value, newPath);
        }
    });
}

module.exports = traverseObject;