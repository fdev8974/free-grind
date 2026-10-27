// Copyright 2020-2023 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

package {{package}}

import java.io.InputStream

class RustInputStream(private val handle: Long) : InputStream() {
    override fun available(): Int = Rust.streamAvailable(handle)

    override fun skip(n: Long): Long = Rust.streamSkip(handle, n)

    override fun read(b: ByteArray, off: Int, len: Int): Int = Rust.streamRead(handle, b, off, len)

    override fun read(): Int {
        val one = ByteArray(1)
        return if (read(one, 0, 1) == 1) one[0].toInt() and 0xff else -1
    }

    override fun close() = Rust.streamClose(handle)
}
