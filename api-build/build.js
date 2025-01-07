import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { execSync, exec } from 'child_process'
import os from 'os'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 添加日志工具对象
const logger = {
  info: (message, append = '') => console.log(`\x1b[36mℹ ${message}\x1b[0m${append}`),
  success: (message, append = '') => console.log(`\x1b[32m✔ ${message}\x1b[0m${append}`),
  warn: (message, append = '') => console.log(`\x1b[33m⚠ ${message}\x1b[0m${append}`),
  error: (message, append = '') => console.log(`\x1b[31m✘ ${message}\x1b[0m${append}`),
  step: (message, append = '') => console.log(`\x1b[34m→ ${message}\x1b[0m${append}`),
  title: (message, append = '') => console.log(`\x1b[35m${message}\x1b[0m\n${append}`),
  tip: (message, append = '') => console.log(`\x1b[90m💡 ${message}\x1b[0m${append}`),
}

// 验证命令行参数
const validateArgs = () => {
  const [swaggerUrl, outputDir] = process.argv.slice(2)

  // 检查参数是否存在
  if (!swaggerUrl || !outputDir)
    throw new Error(
      '需要提供两个参数\n' +
        '用法: node build-api.js <swagger-url> <output-directory>\n' +
        '示例: node build-api.js "http://localhost:8080/api/swagger.json" "src/apis"'
    )

  // 验证 Swagger URL
  try {
    new URL(swaggerUrl)
  } catch {
    throw new Error(`无效的 Swagger API URL: ${swaggerUrl}`)
  }

  return {
    swaggerUrl: encodeURI(swaggerUrl),
    outputPath: validatePath(outputDir),
  }
}

// 验证并处理输出路径
const validatePath = (inputPath) => {
  if (!inputPath) throw new Error('请提供输出目录路径')

  const absolutePath = path.isAbsolute(inputPath) ? inputPath : path.resolve(process.cwd(), inputPath)

  const parentDir = path.dirname(absolutePath)
  if (!fs.existsSync(parentDir)) throw new Error(`输出目录的父目录不存在: ${parentDir}`)

  return absolutePath
}

// 确保目录存在
const ensureDirectoryExists = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    try {
      fs.mkdirSync(dirPath, { recursive: true })
      logger.success(`目录创建成功: ${dirPath}`)
    } catch (error) {
      throw new Error(`目录创建失败 ${dirPath}: ${error.message}`)
    }
  }
}

// 解压ZIP文件
function unzipFile(zipPath, extractPath, options = {}) {
  // 确保路径是绝对路径
  const absoluteZipPath = path.resolve(zipPath)
  const absoluteExtractPath = path.resolve(extractPath)

  // 检查源文件是否存在
  if (!fs.existsSync(absoluteZipPath)) {
    throw new Error(`ZIP文件不存在: ${absoluteZipPath}`)
  }

  // 确保目标目录存在
  if (!fs.existsSync(absoluteExtractPath)) {
    fs.mkdirSync(absoluteExtractPath, { recursive: true })
  }

  // 根据操作系统构建命令
  let command
  switch (os.platform()) {
    case 'win32': // Windows
      command = `powershell -command "Expand-Archive -Path '${absoluteZipPath}' -DestinationPath '${absoluteExtractPath}' -Force"`
      break
    case 'darwin': // macOS
    case 'linux': // Linux
      try {
        command = `unzip -o "${absoluteZipPath}" -d "${absoluteExtractPath}"`
        break
      } catch (error) {
        if (error.message.includes('command not found')) {
          throw new Error(
            '系统未安装 unzip 工具，请先安装：\n' +
              '- Ubuntu/Debian: sudo apt-get install unzip\n' +
              '- CentOS/RHEL: sudo yum install unzip\n' +
              '- macOS: brew install unzip'
          )
        }
        throw error
      }
    default:
      throw new Error(`不支持的操作系统: ${os.platform()}`)
  }

  // 同步执行解压命令
  try {
    execSync(command, {
      stdio: options.silent ? 'ignore' : 'inherit',
      maxBuffer: 1024 * 1024 * 10,
    })
  } catch (error) {
    throw new Error(`解压失败: ${error.message}`)
  }
}

// 递归删除目录
const removeDirectoryRecursive = (dirPath) => {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file)
      if (fs.lstatSync(curPath).isDirectory()) {
        removeDirectoryRecursive(curPath)
      } else {
        fs.unlinkSync(curPath)
      }
    })
    fs.rmdirSync(dirPath)
  }
}

// 获取语义化版本中最新的jar包
const getLatestSwaggerCodegenJar = (codegenDir) => {
  // 确保目录存在
  if (!fs.existsSync(codegenDir)) {
    throw new Error(`Codegen目录不存在: ${codegenDir}`)
  }

  // 获取所有swagger-codegen-cli jar文件
  const files = fs.readdirSync(codegenDir).filter((file) => file.startsWith('swagger-codegen-cli-') && file.endsWith('.jar'))

  if (files.length === 0) {
    throw new Error('未找到swagger-codegen-cli jar文件')
  }

  // 从文件名中提取版本号并排序
  const sortedFiles = files.sort((a, b) => {
    const versionA = a.match(/swagger-codegen-cli-(\d+\.\d+\.\d+)\.jar/)[1]
    const versionB = b.match(/swagger-codegen-cli-(\d+\.\d+\.\d+)\.jar/)[1]

    const partsA = versionA.split('.').map(Number)
    const partsB = versionB.split('.').map(Number)

    // 比较主版本号
    if (partsA[0] !== partsB[0]) return partsB[0] - partsA[0]
    // 比较次版本号
    if (partsA[1] !== partsB[1]) return partsB[1] - partsA[1]
    // 比较修订版本号
    return partsB[2] - partsA[2]
  })

  return path.join(codegenDir, sortedFiles[0])
}

// API 生成主函数
const generateApi = async (swaggerUrl, outputPath) => {
  try {
    logger.title('╭────────────── 🚀 启动 API 代码构建 🚀 ──────────────╮')

    const platform = os.platform()
    const arch = os.arch()
    logger.info(`系统环境:\t${platform}(${arch}), OsVersion = ${os.release()}`)

    const validatedPath = validatePath(outputPath)
    logger.info(`Swagger 地址:\t${swaggerUrl}`)
    logger.info(`代码输出目录:\t${validatedPath}`)

    ensureDirectoryExists(validatedPath)

    let jreZipPath = path.join(
      __dirname,
      'jre',
      `jre11_${arch === 'arm64' ? 'aarch64' : arch}_${
        platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : platform
      }.zip`
    )

    if (!jreZipPath || !fs.existsSync(jreZipPath)) {
      throw new Error(`文件 ${jreZipPath} 没有预先内置，请自行到 https://adoptium.net/ 下载并解压到 jre/jre11 目录中`)
    }

    const jreDir = path.join(__dirname, 'jre', 'jre11')
    if (!(fs.existsSync(jreDir) && fs.readdirSync(jreDir).length > 0)) {
      logger.step('JRE 文件不存在，正在解压...', jreZipPath, jreDir)
      await unzipFile(jreZipPath, jreDir)
    }
    logger.info(`JRE 环境目录:\t${jreDir}`)

    const javaPath = path.join(jreDir, 'bin', 'java')
    if (!fs.existsSync(javaPath) && !fs.existsSync(javaPath + '.exe')) {
      throw new Error(`未找到 Java 执行文件: ${javaPath}`)
    }
    logger.info(`Java执行文件:\t${javaPath}`)

    const codegenDir = path.join(__dirname, 'codegen')
    const swaggerJar = getLatestSwaggerCodegenJar(codegenDir)
    if (!fs.existsSync(swaggerJar)) {
      throw new Error(`未找到 Swagger 工具: ${swaggerJar}`)
    }
    logger.info(`生成器JAR:\t${swaggerJar}`, '\n')

    const swaggerCommand = `"${javaPath}" -jar "${swaggerJar}" generate -i "${swaggerUrl}" -l typescript-axios -o "${validatedPath}"`

    logger.step('[1/3] 清理输出目录...')
    removeDirectoryRecursive(validatedPath)

    logger.step('[2/3] 生成API代码...', '\x1b[31m')
    execSync(swaggerCommand, { stdio: ['ignore', 'ignore', 'inherit'] })

    const filesToRemove = [
      '.swagger-codegen',
      '.gitignore',
      '.npmignore',
      '.swagger-codegen-ignore',
      'git_push.sh',
      'package.json',
      'README.md',
      'tsconfig.json',
    ]

    logger.step('[3/3] 清理无用文件...', '\n')
    filesToRemove.forEach((file) => {
      const filePath = path.join(validatedPath, file)
      if (fs.existsSync(filePath)) {
        if (fs.lstatSync(filePath).isDirectory()) {
          removeDirectoryRecursive(filePath)
        } else {
          fs.unlinkSync(filePath)
        }
      }
    })

    logger.tip(`代码输出目录: ${validatedPath}`)
    console.log('\n\x1b[38;5;51m╰────────────── ✨ API 代码构建完成 ✨ ───────────────╯\x1b[0m')
  } catch (error) {
    logger.error(error.message)
    process.exit(1)
  }
}

// 主执行逻辑
try {
  const { swaggerUrl, outputPath } = validateArgs()
  generateApi(swaggerUrl, outputPath)
} catch (error) {
  logger.error(error.message)
  process.exit(1)
}
